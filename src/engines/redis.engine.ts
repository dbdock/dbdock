import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { join } from 'path';
import Redis from 'ioredis';
import {
  DatabaseEngine,
  DatabaseStats,
  DbConnection,
  DumpHandle,
} from './engine.types';
import { EngineErrorContext, ErrorPattern, explainError } from './error-format';

const DEFAULT_PORT = 6379;
const WORKER_PATH = join(__dirname, 'redis-worker.js');
const CLIENT_TOOL_HINT =
  'Redis backups use the bundled dbdock worker over the network — ensure the Redis server is running and reachable.';

function resolveDb(conn: DbConnection): string {
  return conn.database && conn.database.trim() !== '' ? conn.database : '0';
}

function workerEnv(conn: DbConnection): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DBDOCK_REDIS_HOST: conn.host || 'localhost',
    DBDOCK_REDIS_PORT: String(conn.port || DEFAULT_PORT),
    DBDOCK_REDIS_USERNAME: conn.user || conn.username || '',
    DBDOCK_REDIS_PASSWORD:
      conn.password || process.env.DBDOCK_DB_PASSWORD || '',
    DBDOCK_REDIS_DB: resolveDb(conn),
  };
}

function buildClient(conn: DbConnection): Redis {
  return new Redis({
    host: conn.host || 'localhost',
    port: conn.port || DEFAULT_PORT,
    username: conn.user || conn.username || undefined,
    password: conn.password || process.env.DBDOCK_DB_PASSWORD || undefined,
    db: parseInt(resolveDb(conn), 10) || 0,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
}

// Redis (ioredis) error vocabulary, most-specific first.
const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: 'auth',
    pattern: /wrongpass|noauth|invalid username-password|without any password/i,
  },
  { category: 'badDb', pattern: /db index is out of range|invalid db index/i },
  {
    category: 'refused',
    pattern:
      /econnrefused|connection refused|enotfound|etimedout|connection is closed/i,
  },
];

// `conn` is omitted for restore errors, which carry no connection context.
function errorContext(conn?: DbConnection): EngineErrorContext {
  return {
    serverLabel: 'Redis server',
    host: conn ? conn.host || 'localhost' : '',
    port: conn ? String(conn.port || DEFAULT_PORT) : '',
    username: conn ? conn.user || conn.username || 'default' : '',
    database: conn ? resolveDb(conn) : '',
  };
}

export const redisEngine: DatabaseEngine = {
  id: 'redis',
  label: 'Redis',
  defaultPort: DEFAULT_PORT,
  defaultUser: 'default',
  clientToolHint: CLIENT_TOOL_HINT,

  fileExtension() {
    return 'redis';
  },

  spawnDump(conn): DumpHandle {
    const proc = spawn(process.execPath, [WORKER_PATH, 'dump'], {
      env: workerEnv(conn),
    });
    return { process: proc, stdout: proc.stdout };
  },

  spawnRestore(conn): ChildProcessWithoutNullStreams {
    return spawn(process.execPath, [WORKER_PATH, 'restore'], {
      env: workerEnv(conn),
    });
  },

  async testConnection(conn): Promise<void> {
    const client = buildClient(conn);
    // Capturing the error keeps ioredis from printing it as an "Unhandled
    // error event" (raw stack) and lets us classify the real cause instead of
    // the generic "Connection is closed." that connect() rejects with.
    let captured: string | undefined;
    client.on('error', (err: Error) => {
      if (!captured) captured = err.message;
    });
    try {
      await client.connect();
      // Validate the configured DB index explicitly — an out-of-range index
      // otherwise surfaces only as an async error and would be reported as a
      // successful connection.
      await client.select(parseInt(resolveDb(conn), 10) || 0);
      await client.ping();
    } catch (err) {
      const raw =
        captured || (err instanceof Error ? err.message : String(err));
      throw new Error(
        explainError({
          raw,
          patterns: ERROR_PATTERNS,
          ctx: errorContext(conn),
          tool: 'redis',
          mode: 'connect',
        }),
      );
    } finally {
      client.disconnect();
    }
  },

  async getStats(conn): Promise<DatabaseStats> {
    const client = buildClient(conn);
    try {
      await client.connect();
      const keyCount = await client.dbsize();
      const info = await client.info('memory');
      const match = info.match(/used_memory_human:(\S+)/);
      return {
        name: `db${resolveDb(conn)}`,
        tables: keyCount,
        size: match ? match[1] : 'Unknown',
        rows: keyCount.toLocaleString(),
      };
    } finally {
      client.disconnect();
    }
  },

  formatDumpError(exitCode, errorMessages, conn): string {
    return explainError({
      raw: errorMessages.join('\n'),
      patterns: ERROR_PATTERNS,
      ctx: errorContext(conn),
      tool: 'Redis backup',
      exitCode,
      mode: 'dump',
    });
  },

  formatRestoreError(errorOutput): string {
    return explainError({
      raw: errorOutput,
      patterns: ERROR_PATTERNS,
      ctx: errorContext(),
      tool: 'Redis restore',
      mode: 'restore',
    });
  },

  shouldIgnoreRestoreMessage(message): boolean {
    return message.toLowerCase().includes('busykey');
  },
};
