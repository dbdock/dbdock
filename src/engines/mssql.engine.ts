import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { Transform } from 'stream';
import {
  DatabaseEngine,
  DatabaseStats,
  DbConnection,
  DumpHandle,
} from './engine.types';
import { EngineErrorContext, ErrorPattern, explainError } from './error-format';

const DUMP_BINARY = 'mssql-scripter';
const CLIENT_BINARY = 'sqlcmd';
const DEFAULT_PORT = 1433;
const CLIENT_TOOL_HINT =
  'Please ensure SQL Server client tools are installed:\n' +
  '  sqlcmd (restore):  brew install sqlcmd  |  https://aka.ms/sqlcmd\n' +
  '  mssql-scripter (backup):  pip install mssql-scripter';

function resolveUser(conn: DbConnection): string {
  return conn.user || conn.username || process.env.DBDOCK_DB_USER || 'sa';
}

function resolvePassword(conn: DbConnection): string | undefined {
  return conn.password || process.env.DBDOCK_DB_PASSWORD;
}

function serverArg(conn: DbConnection): string {
  return `${conn.host || 'localhost'},${conn.port || DEFAULT_PORT}`;
}

// SQL Server / sqlcmd error vocabulary, most-specific first.
const ERROR_PATTERNS: ErrorPattern[] = [
  { category: 'auth', pattern: /login failed/i },
  { category: 'badDb', pattern: /cannot open database|does not exist/i },
  {
    category: 'refused',
    pattern: /could not open a connection|network-related|econnrefused/i,
  },
];

// `conn` is omitted for restore errors, which carry no connection context.
function errorContext(conn?: DbConnection): EngineErrorContext {
  return {
    serverLabel: 'SQL Server',
    host: conn ? conn.host || 'localhost' : '',
    port: conn ? String(conn.port || DEFAULT_PORT) : '',
    username: conn ? resolveUser(conn) : '',
    database: conn ? conn.database || 'master' : '',
  };
}

function stripLeadingBom(): Transform {
  let checked = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!checked) {
        checked = true;
        if (
          chunk.length >= 3 &&
          chunk[0] === 0xef &&
          chunk[1] === 0xbb &&
          chunk[2] === 0xbf
        ) {
          callback(null, chunk.subarray(3));
          return;
        }
      }
      callback(null, chunk);
    },
  });
}

function sqlcmdEnv(conn: DbConnection): NodeJS.ProcessEnv {
  const password = resolvePassword(conn);
  return password
    ? { ...process.env, SQLCMDPASSWORD: password }
    : { ...process.env };
}

function scripterEnv(conn: DbConnection): NodeJS.ProcessEnv {
  const password = resolvePassword(conn);
  return password
    ? { ...process.env, MSSQL_SCRIPTER_PASSWORD: password }
    : { ...process.env };
}

function sqlcmdArgs(conn: DbConnection, extra: string[]): string[] {
  return [
    '-S',
    serverArg(conn),
    '-U',
    resolveUser(conn),
    '-d',
    conn.database || 'master',
    '-C',
    ...extra,
  ];
}

function runQuery(conn: DbConnection, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      CLIENT_BINARY,
      sqlcmdArgs(conn, ['-h', '-1', '-W', '-b', '-Q', query]),
      { env: sqlcmdEnv(conn) },
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

export const mssqlEngine: DatabaseEngine = {
  id: 'mssql',
  label: 'SQL Server',
  defaultPort: DEFAULT_PORT,
  defaultUser: 'sa',
  clientToolHint: CLIENT_TOOL_HINT,

  fileExtension() {
    return 'sql';
  },

  spawnDump(conn): DumpHandle {
    const args = [
      '-S',
      serverArg(conn),
      '-d',
      conn.database || 'master',
      '-U',
      resolveUser(conn),
      '--schema-and-data',
      '--script-drop-create',
      '--exclude-headers',
    ];
    const proc = spawn(DUMP_BINARY, args, { env: scripterEnv(conn) });
    return { process: proc, stdout: proc.stdout.pipe(stripLeadingBom()) };
  },

  spawnRestore(conn): ChildProcessWithoutNullStreams {
    return spawn(CLIENT_BINARY, sqlcmdArgs(conn, ['-b']), {
      env: sqlcmdEnv(conn),
    });
  },

  testConnection(conn): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(
        CLIENT_BINARY,
        sqlcmdArgs(conn, ['-b', '-Q', 'SELECT 1']),
        { env: sqlcmdEnv(conn) },
      );
      let errorOutput = '';
      proc.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
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
              tool: 'sqlcmd',
              exitCode: code ?? undefined,
              mode: 'connect',
            }),
          ),
        );
      });
      proc.on('error', (err) => {
        reject(
          new Error(
            `Failed to execute sqlcmd: ${err.message}\n\n${CLIENT_TOOL_HINT}`,
          ),
        );
      });
    });
  },

  async getStats(conn): Promise<DatabaseStats> {
    const database = conn.database || 'master';
    const [tableCount, sizeMb, rowCount] = await Promise.all([
      runQuery(
        conn,
        'SET NOCOUNT ON; SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped = 0',
      ),
      runQuery(
        conn,
        'SET NOCOUNT ON; SELECT CAST(SUM(size) * 8.0 / 1024 AS DECIMAL(10,2)) FROM sys.database_files WHERE type = 0',
      ),
      runQuery(
        conn,
        'SET NOCOUNT ON; SELECT ISNULL(SUM(p.rows),0) FROM sys.tables t JOIN sys.partitions p ON t.object_id = p.object_id WHERE p.index_id IN (0,1) AND t.is_ms_shipped = 0',
      ),
    ]);

    return {
      name: database,
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
      tool: 'mssql-scripter',
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
      lower.includes('rows affected') ||
      lower.includes('changed database context')
    );
  },
};
