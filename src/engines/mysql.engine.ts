import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import {
  DatabaseEngine,
  DatabaseStats,
  DbConnection,
  DumpHandle,
} from './engine.types';
import { EngineErrorContext, ErrorPattern, explainError } from './error-format';

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

// MySQL/MariaDB client error vocabulary, most-specific first.
const ERROR_PATTERNS: ErrorPattern[] = [
  { category: 'auth', pattern: /access denied/i },
  { category: 'badDb', pattern: /unknown database/i },
  {
    category: 'refused',
    pattern: /can't connect|connection refused|econnrefused/i,
  },
];

// `conn` is omitted for restore errors, which carry no connection context.
function errorContext(conn?: DbConnection): EngineErrorContext {
  return {
    serverLabel: 'MySQL/MariaDB server',
    host: conn ? conn.host || 'localhost' : '',
    port: conn ? String(conn.port || DEFAULT_PORT) : '',
    username: conn ? resolveUser(conn) : '',
    database: conn ? conn.database || '' : '',
  };
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
              tool: 'mysql',
              exitCode: code ?? undefined,
              mode: 'connect',
            }),
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
    return explainError({
      raw: errorMessages.join('\n'),
      patterns: ERROR_PATTERNS,
      ctx: errorContext(conn),
      tool: 'mysqldump',
      exitCode,
      mode: 'dump',
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
    return (
      lower.includes('[warning]') ||
      lower.includes('using a password on the command line')
    );
  },
};
