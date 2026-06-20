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
    try {
      await client.connect();
      await client.ping();
    } catch (err) {
      throw new Error(
        `Database connection failed: ${err instanceof Error ? err.message : String(err)}`,
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
    const errorMessage = errorMessages.join('\n');
    const lower = errorMessage.toLowerCase();
    const host = conn.host || 'localhost';
    const port = conn.port || DEFAULT_PORT;

    if (lower.includes('wrongpass') || lower.includes('noauth')) {
      return (
        'Redis authentication failed\n\n' +
        'Please verify:\n  • The password is correct in dbdock.config.json\n  • The username (if using ACLs) is correct'
      );
    }
    if (lower.includes('econnrefused') || lower.includes('connect')) {
      return (
        'Cannot connect to Redis server\n\n' +
        `Connection details:\n  Host: ${host}\n  Port: ${port}\n\n` +
        'Please verify:\n  • The server is running\n  • Host and port are correct\n  • Network/firewall allows connection'
      );
    }
    if (errorMessages.length > 0) {
      return (
        `Redis backup failed with exit code ${exitCode}\n\n` +
        `Error details:\n${errorMessage}`
      );
    }
    return `Redis backup failed with exit code ${exitCode}.`;
  },

  formatRestoreError(errorOutput): string {
    const lower = errorOutput.toLowerCase();

    if (lower.includes('wrongpass') || lower.includes('noauth')) {
      return (
        'Redis authentication failed\n\n' +
        'Please verify:\n  • The password is correct\n  • The user has write access'
      );
    }
    if (lower.includes('econnrefused') || lower.includes('connect')) {
      return (
        'Failed to connect to Redis\n\n' +
        'Please verify:\n  • The server is running\n  • Host and port are correct'
      );
    }
    return `Redis restore error:\n\n${errorOutput.trim()}`;
  },

  shouldIgnoreRestoreMessage(message): boolean {
    return message.toLowerCase().includes('busykey');
  },
};
