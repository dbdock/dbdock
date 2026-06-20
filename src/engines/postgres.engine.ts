import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import {
  DatabaseEngine,
  DatabaseStats,
  DbConnection,
  DumpHandle,
  DumpSpawnOptions,
} from './engine.types';

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
    const process = spawn('pg_dump', args, { env: buildEnv(conn) });
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
    return spawn('pg_restore', args, { env: buildEnv(conn) });
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
      const proc = spawn('psql', args, { env: buildEnv(conn) });
      let hasError = false;
      proc.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        if (!message.includes('NOTICE')) {
          hasError = true;
          reject(new Error(`Database connection failed: ${message}`));
        }
      });
      proc.on('close', (code) => {
        if (hasError) return;
        if (code === 0) resolve();
        else
          reject(new Error(`Database connection failed (exit code ${code})`));
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
            const proc = spawn('psql', [...baseArgs, '-c', query], { env });
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
    const errorMessage = errorMessages.join('\n');
    const host = conn.host || 'localhost';
    const port = conn.port || DEFAULT_PORT;
    const username = resolveUser(conn);
    const database = conn.database || 'postgres';

    if (
      errorMessage.includes('database') &&
      errorMessage.includes('does not exist')
    ) {
      const dbMatch = errorMessage.match(/database "([^"]+)" does not exist/);
      const dbName = dbMatch ? dbMatch[1] : database;
      return (
        `Database "${dbName}" does not exist\n\n` +
        `Connection details:\n  Host: ${host}\n  Port: ${port}\n  Database: ${dbName}\n\n` +
        `Please verify:\n` +
        `  • Database name is correct in dbdock.config.json\n` +
        `  • Database exists on the server\n` +
        `  • You can connect: psql -h ${host} -p ${port} -U ${username} -d ${dbName}`
      );
    }

    if (
      errorMessage.includes('could not connect') ||
      errorMessage.includes('Connection refused') ||
      errorMessage.includes('ECONNREFUSED')
    ) {
      return (
        `Cannot connect to PostgreSQL server\n\n` +
        `Connection details:\n  Host: ${host}\n  Port: ${port}\n\n` +
        `Please verify:\n` +
        `  • PostgreSQL server is running\n` +
        `  • Host and port are correct in dbdock.config.json\n` +
        `  • Network/firewall allows connection\n` +
        `  • Test connection: psql -h ${host} -p ${port} -U ${username} -d ${database}`
      );
    }

    if (
      errorMessage.includes('authentication failed') ||
      errorMessage.includes('password authentication failed')
    ) {
      return (
        `Authentication failed for user "${username}"\n\n` +
        `Connection details:\n  Host: ${host}\n  Port: ${port}\n  Username: ${username}\n  Database: ${database}\n\n` +
        `Please verify:\n` +
        `  • Username and password are correct in dbdock.config.json\n` +
        `  • User exists and has access to the database`
      );
    }

    if (errorMessage.includes('permission denied')) {
      return (
        `Permission denied for user "${username}"\n\n` +
        `The user does not have sufficient privileges to perform backup.\n\n` +
        `Please verify:\n` +
        `  • User has read permissions on the database\n` +
        `  • Grant access: GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${username};`
      );
    }

    if (errorMessages.length > 0) {
      return (
        `pg_dump failed with exit code ${exitCode}\n\n` +
        `Error details:\n${errorMessage}\n\n` +
        `Connection settings:\n  Host: ${host}\n  Port: ${port}\n  Username: ${username}\n  Database: ${database}`
      );
    }

    return `pg_dump failed with exit code ${exitCode}. Please check your database configuration.`;
  },

  formatRestoreError(errorOutput): string {
    const lowerError = errorOutput.toLowerCase();

    if (lowerError.includes('authentication failed')) {
      return (
        'Database authentication failed\n\n' +
        'Please verify:\n  • Database password is correct\n  • Database user has necessary permissions\n  • Database host and port are accessible'
      );
    }
    if (
      lowerError.includes('connection refused') ||
      lowerError.includes('could not connect')
    ) {
      return (
        'Failed to connect to database\n\n' +
        'Please verify:\n  • Database server is running\n  • Host and port are correct\n  • Firewall allows connection to the database port'
      );
    }
    if (lowerError.includes('permission denied')) {
      return (
        'Database permission denied\n\n' +
        'Please verify:\n  • Database user has CREATE/DROP privileges\n  • Try using a superuser account for restore'
      );
    }
    if (
      lowerError.includes('database') &&
      lowerError.includes('does not exist')
    ) {
      return (
        'Target database does not exist\n\n' +
        'Please:\n  • Create the database first, or\n  • Update database name in dbdock.config.json'
      );
    }
    if (
      lowerError.includes('corrupted') ||
      lowerError.includes('invalid backup')
    ) {
      return (
        'Backup file appears to be corrupted\n\n' +
        'Please:\n  • Try a different backup file\n  • Verify the encryption key matches if encryption is enabled'
      );
    }

    return `Database restore error:\n\n${errorOutput.trim()}`;
  },

  shouldIgnoreRestoreMessage(message): boolean {
    const lower = message.toLowerCase();
    return RESTORE_IGNORE_PATTERNS.some((pattern) =>
      lower.includes(pattern.toLowerCase()),
    );
  },
};
