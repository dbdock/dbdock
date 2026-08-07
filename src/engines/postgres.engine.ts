import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import {
  DatabaseEngine,
  DatabaseStats,
  DbConnection,
  DumpHandle,
  DumpSpawnOptions,
} from './engine.types';
import {
  EngineErrorContext,
  ErrorPattern,
  MismatchVersions,
  explainError,
} from './error-format';
import { assertValidDatabaseName } from './db-name.validator';
import { describePgClient, resolvePgBin } from './pg-bin';

const DEFAULT_PORT = 5432;
const CLIENT_TOOL_HINT =
  'Please ensure PostgreSQL client tools are installed:\n  macOS: brew install postgresql\n  Ubuntu/Debian: sudo apt-get install postgresql-client';

const FORMAT_FLAG: Record<string, string> = {
  custom: 'c',
  plain: 'p',
  directory: 'd',
  tar: 't',
};

const EXTENSION: Record<string, string> = {
  custom: 'sql',
  plain: 'sql',
  directory: 'dir',
  tar: 'tar',
};

function resolveUser(conn: DbConnection): string {
  return conn.user || conn.username || process.env.DBDOCK_DB_USER || 'postgres';
}

function resolvePassword(conn: DbConnection): string | undefined {
  return conn.password || process.env.DBDOCK_DB_PASSWORD;
}

function buildEnv(conn: DbConnection): NodeJS.ProcessEnv {
  const password = resolvePassword(conn);
  return password
    ? { ...process.env, PGPASSWORD: password }
    : { ...process.env };
}

// Postgres/psql error vocabulary, most-specific first.
const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: 'versionMismatch',
    pattern: /server version mismatch|aborting because of server version/i,
  },
  {
    category: 'auth',
    pattern:
      /authentication failed|credentials are incorrect|password.*incorrect|failed to identify your database/i,
  },
  { category: 'badDb', pattern: /database .*does not exist/i },
  { category: 'permission', pattern: /permission denied/i },
  {
    category: 'refused',
    pattern: /could not connect|connection refused|econnrefused/i,
  },
  { category: 'corrupt', pattern: /corrupt|invalid backup/i },
];

/**
 * dbdock does not bundle libpq — it runs whatever client tools the host has.
 * So a version mismatch is fixed by installing the client for the *server's*
 * major version; naming that major (and the client dbdock actually picked)
 * turns a dead end into a copy-pasteable command.
 */
function pgVersionRemedy({ server }: MismatchVersions): string {
  const major = Number(/^(\d+)/.exec(server ?? '')?.[1]);
  const found = describePgClient('pg_dump');
  const using =
    found.major !== null
      ? `\n\ndbdock is currently using ${found.path} (${found.major}.x).`
      : '';

  if (!Number.isFinite(major)) {
    return (
      'dbdock runs the PostgreSQL client tools installed on this machine.\n' +
      'Install a client at or above your server major version, or point\n' +
      'DBDOCK_PG_BIN_DIR at a directory that already has one.' +
      using
    );
  }

  return (
    `dbdock runs the PostgreSQL client tools installed on this machine, so\n` +
    `install the ${major} client and dbdock will pick it up automatically:\n\n` +
    `  Debian/Ubuntu:  sudo apt-get install postgresql-client-${major}\n` +
    `                  (needs the PGDG repo: https://www.postgresql.org/download/linux/ubuntu/)\n` +
    `  RHEL/Fedora:    sudo dnf install postgresql${major}\n` +
    `  macOS:          brew install postgresql@${major}\n` +
    `  Windows:        https://www.postgresql.org/download/windows/\n\n` +
    `Already installed elsewhere? Point dbdock at it:\n` +
    `  export DBDOCK_PG_BIN_DIR=/usr/lib/postgresql/${major}/bin` +
    using
  );
}

// `conn` is omitted for restore errors, which carry no connection context.
function errorContext(conn?: DbConnection): EngineErrorContext {
  return {
    serverLabel: 'PostgreSQL server',
    host: conn ? conn.host || 'localhost' : '',
    port: conn ? String(conn.port || DEFAULT_PORT) : '',
    username: conn ? resolveUser(conn) : '',
    database: conn ? conn.database || 'postgres' : '',
  };
}

const RESTORE_IGNORE_PATTERNS = [
  'NOTICE',
  'WARNING',
  'transaction_timeout',
  'errors ignored on restore',
  'unrecognized configuration parameter',
  'already exists',
  'does not exist',
  'no privileges could be revoked',
  'no privileges were granted',
  'role .* does not exist',
  'extension .* already exists',
  'schema .* already exists',
  'procedural language .* already exists',
];

export const postgresEngine: DatabaseEngine = {
  id: 'postgresql',
  label: 'PostgreSQL',
  defaultPort: DEFAULT_PORT,
  defaultUser: 'postgres',
  clientToolHint: CLIENT_TOOL_HINT,

  fileExtension(format = 'custom') {
    return EXTENSION[format] || 'sql';
  },

  spawnDump(conn, options: DumpSpawnOptions): DumpHandle {
    const format = options.format || 'custom';
    const args = [
      '-h',
      conn.host || 'localhost',
      '-p',
      String(conn.port || DEFAULT_PORT),
      '-U',
      resolveUser(conn),
      '-d',
      conn.database || 'postgres',
      '-F',
      FORMAT_FLAG[format] || 'c',
      '--no-password',
    ];
    const process = spawn(resolvePgBin('pg_dump'), args, {
      env: buildEnv(conn),
    });
    return { process, stdout: process.stdout };
  },

  spawnRestore(conn): ChildProcessWithoutNullStreams {
    const args = [
      '-h',
      conn.host || 'localhost',
      '-p',
      String(conn.port || DEFAULT_PORT),
      '-U',
      resolveUser(conn),
      '-d',
      conn.database || 'postgres',
      '-F',
      'c',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--no-password',
    ];
    return spawn(resolvePgBin('pg_restore'), args, { env: buildEnv(conn) });
  },

  testConnection(conn): Promise<void> {
    const args = [
      '-h',
      conn.host || 'localhost',
      '-p',
      String(conn.port || DEFAULT_PORT),
      '-U',
      resolveUser(conn),
      '-d',
      conn.database || 'postgres',
      '-c',
      'SELECT 1',
      '--no-password',
    ];
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(resolvePgBin('psql'), args, { env: buildEnv(conn) });
      let errorOutput = '';
      proc.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        if (!message.includes('NOTICE')) {
          errorOutput += message;
        }
      });
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            explainError({
              raw: errorOutput,
              patterns: ERROR_PATTERNS,
              ctx: errorContext(conn),
              tool: 'psql',
              exitCode: code ?? undefined,
              mode: 'connect',
              remedy: pgVersionRemedy,
            }),
          ),
        );
      });
      proc.on('error', (err) => {
        reject(
          new Error(
            `Failed to execute psql: ${err.message}\n\n${CLIENT_TOOL_HINT}`,
          ),
        );
      });
    });
  },

  async getStats(conn): Promise<DatabaseStats> {
    const database = conn.database || 'postgres';
    assertValidDatabaseName(database);
    const queries = [
      `SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'`,
      `SELECT pg_size_pretty(pg_database_size('${database}')) as size`,
      `SELECT sum(n_live_tup) as total_rows FROM pg_stat_user_tables`,
    ];

    const baseArgs = [
      '-h',
      conn.host || 'localhost',
      '-p',
      String(conn.port || DEFAULT_PORT),
      '-U',
      resolveUser(conn),
      '-d',
      database,
      '-t',
      '--no-password',
    ];
    const env = buildEnv(conn);

    const results = await Promise.all(
      queries.map(
        (query) =>
          new Promise<string>((resolve, reject) => {
            const proc = spawn(
              resolvePgBin('psql'),
              [...baseArgs, '-c', query],
              {
                env,
              },
            );
            let output = '';
            let errorOutput = '';
            proc.stdout.on('data', (data: Buffer) => {
              output += data.toString();
            });
            proc.stderr.on('data', (data: Buffer) => {
              errorOutput += data.toString();
            });
            proc.on('close', (code) => {
              if (code === 0) resolve(output.trim());
              else reject(new Error(errorOutput || `Query failed (${code})`));
            });
            proc.on('error', reject);
          }),
      ),
    );

    return {
      name: database,
      tables: parseInt(results[0]) || 0,
      size: results[1] || 'Unknown',
      rows: results[2] ? parseInt(results[2]).toLocaleString() : '0',
    };
  },

  formatDumpError(exitCode, errorMessages, conn): string {
    return explainError({
      raw: errorMessages.join('\n'),
      patterns: ERROR_PATTERNS,
      ctx: errorContext(conn),
      tool: 'pg_dump',
      exitCode,
      mode: 'dump',
      remedy: pgVersionRemedy,
    });
  },

  formatRestoreError(errorOutput): string {
    return explainError({
      raw: errorOutput,
      patterns: ERROR_PATTERNS,
      ctx: errorContext(),
      tool: 'Database restore',
      mode: 'restore',
    });
  },

  shouldIgnoreRestoreMessage(message): boolean {
    const lower = message.toLowerCase();
    return RESTORE_IGNORE_PATTERNS.some((pattern) =>
      lower.includes(pattern.toLowerCase()),
    );
  },
};
