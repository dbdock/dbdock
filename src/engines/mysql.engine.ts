import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import {
  DatabaseEngine,
  DatabaseStats,
  DbConnection,
  DumpHandle,
} from './engine.types';

const DUMP_BINARY = 'mysqldump';
const CLIENT_BINARY = 'mysql';
const DEFAULT_PORT = 3306;
const CLIENT_TOOL_HINT =
  'Please ensure MySQL/MariaDB client tools are installed:\n  macOS: brew install mysql-client\n  Ubuntu/Debian: sudo apt-get install mysql-client (or mariadb-client)';

function resolveUser(conn: DbConnection): string {
  return conn.user || conn.username || process.env.DBDOCK_DB_USER || 'root';
}

function resolvePassword(conn: DbConnection): string | undefined {
  return conn.password || process.env.DBDOCK_DB_PASSWORD;
}

function buildEnv(conn: DbConnection): NodeJS.ProcessEnv {
  const password = resolvePassword(conn);
  return password
    ? { ...process.env, MYSQL_PWD: password }
    : { ...process.env };
}

function connectionArgs(conn: DbConnection, defaultPort: number): string[] {
  return [
    '-h',
    conn.host || 'localhost',
    '-P',
    String(conn.port || defaultPort),
    '-u',
    resolveUser(conn),
    '--protocol=TCP',
  ];
}

function runQuery(
  conn: DbConnection,
  defaultPort: number,
  query: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      CLIENT_BINARY,
      [
        ...connectionArgs(conn, defaultPort),
        '-N',
        '-B',
        '-e',
        query,
        conn.database || '',
      ].filter(Boolean),
      { env: buildEnv(conn) },
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
  });
}

export const mysqlEngine: DatabaseEngine = {
  id: 'mysql',
  label: 'MySQL / MariaDB',
  defaultPort: DEFAULT_PORT,
  defaultUser: 'root',
  clientToolHint: CLIENT_TOOL_HINT,

  fileExtension() {
    return 'sql';
  },

  spawnDump(conn): DumpHandle {
    const args = [
      ...connectionArgs(conn, DEFAULT_PORT),
      '--single-transaction',
      '--quick',
      '--routines',
      '--triggers',
      '--events',
      '--default-character-set=utf8mb4',
      conn.database || '',
    ];
    const process = spawn(DUMP_BINARY, args, { env: buildEnv(conn) });
    return { process, stdout: process.stdout };
  },

  spawnRestore(conn): ChildProcessWithoutNullStreams {
    const args = [...connectionArgs(conn, DEFAULT_PORT), conn.database || ''];
    return spawn(CLIENT_BINARY, args, { env: buildEnv(conn) });
  },

  testConnection(conn): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(
        CLIENT_BINARY,
        [...connectionArgs(conn, DEFAULT_PORT), '-e', 'SELECT 1'],
        { env: buildEnv(conn) },
      );
      let errorOutput = '';
      proc.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        if (!message.toLowerCase().includes('[warning]')) {
          errorOutput += message;
        }
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Database connection failed: ${errorOutput || `exit code ${code}`}`,
            ),
          );
      });
      proc.on('error', (err) => {
        reject(
          new Error(
            `Failed to execute mysql: ${err.message}\n\n${CLIENT_TOOL_HINT}`,
          ),
        );
      });
    });
  },

  async getStats(conn): Promise<DatabaseStats> {
    const database = conn.database || '';
    const schemaFilter = database
      ? `WHERE table_schema = '${database}'`
      : `WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys')`;

    const [tableCount, sizeMb, rowCount] = await Promise.all([
      runQuery(
        conn,
        DEFAULT_PORT,
        `SELECT COUNT(*) FROM information_schema.tables ${schemaFilter}`,
      ),
      runQuery(
        conn,
        DEFAULT_PORT,
        `SELECT IFNULL(ROUND(SUM(data_length + index_length) / 1024 / 1024, 2), 0) FROM information_schema.tables ${schemaFilter}`,
      ),
      runQuery(
        conn,
        DEFAULT_PORT,
        `SELECT IFNULL(SUM(table_rows), 0) FROM information_schema.tables ${schemaFilter}`,
      ),
    ]);

    return {
      name: database || 'mysql',
      tables: parseInt(tableCount) || 0,
      size: sizeMb ? `${sizeMb} MB` : 'Unknown',
      rows: rowCount ? parseInt(rowCount).toLocaleString() : '0',
    };
  },

  formatDumpError(exitCode, errorMessages, conn): string {
    const errorMessage = errorMessages.join('\n');
    const lower = errorMessage.toLowerCase();
    const host = conn.host || 'localhost';
    const port = conn.port || DEFAULT_PORT;
    const username = resolveUser(conn);
    const database = conn.database || '';

    if (lower.includes('access denied')) {
      return (
        `Authentication failed for user "${username}"\n\n` +
        `Connection details:\n  Host: ${host}\n  Port: ${port}\n  Username: ${username}\n  Database: ${database}\n\n` +
        `Please verify:\n` +
        `  • Username and password are correct in dbdock.config.json\n` +
        `  • User has access to the database from this host`
      );
    }
    if (lower.includes('unknown database')) {
      return (
        `Database "${database}" does not exist\n\n` +
        `Please verify:\n` +
        `  • Database name is correct in dbdock.config.json\n` +
        `  • Database exists on the server`
      );
    }
    if (
      lower.includes("can't connect") ||
      lower.includes('connection refused') ||
      lower.includes('econnrefused')
    ) {
      return (
        `Cannot connect to MySQL/MariaDB server\n\n` +
        `Connection details:\n  Host: ${host}\n  Port: ${port}\n\n` +
        `Please verify:\n` +
        `  • The server is running\n` +
        `  • Host and port are correct in dbdock.config.json\n` +
        `  • Network/firewall allows connection`
      );
    }

    if (errorMessages.length > 0) {
      return (
        `mysqldump failed with exit code ${exitCode}\n\n` +
        `Error details:\n${errorMessage}\n\n` +
        `Connection settings:\n  Host: ${host}\n  Port: ${port}\n  Username: ${username}\n  Database: ${database}`
      );
    }

    return `mysqldump failed with exit code ${exitCode}. Please check your database configuration.`;
  },

  formatRestoreError(errorOutput): string {
    const lower = errorOutput.toLowerCase();

    if (lower.includes('access denied')) {
      return (
        'Database authentication failed\n\n' +
        'Please verify:\n  • Database username and password are correct\n  • The user has privileges on the target database'
      );
    }
    if (
      lower.includes("can't connect") ||
      lower.includes('connection refused')
    ) {
      return (
        'Failed to connect to database\n\n' +
        'Please verify:\n  • The server is running\n  • Host and port are correct\n  • Firewall allows connection to the database port'
      );
    }
    if (lower.includes('unknown database')) {
      return (
        'Target database does not exist\n\n' +
        'Please:\n  • Create the database first, or\n  • Update the database name in dbdock.config.json'
      );
    }

    return `Database restore error:\n\n${errorOutput.trim()}`;
  },

  shouldIgnoreRestoreMessage(message): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('[warning]') ||
      lower.includes('using a password on the command line')
    );
  },
};
