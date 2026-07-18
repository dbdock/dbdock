import { getEngine } from '../../engines';

export interface ResolvedConnection {
  type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export const DB_TYPE_CHOICES = [
  { name: 'PostgreSQL', value: 'postgres' },
  { name: 'MySQL', value: 'mysql' },
  { name: 'MariaDB', value: 'mariadb' },
  { name: 'SQL Server', value: 'mssql' },
  { name: 'Redis', value: 'redis' },
  { name: 'CockroachDB (PostgreSQL-compatible)', value: 'cockroachdb' },
  { name: 'Amazon Redshift (PostgreSQL-compatible)', value: 'redshift' },
  { name: 'TimescaleDB (PostgreSQL-compatible)', value: 'timescaledb' },
];

const PROTOCOL_TYPE: Record<string, string> = {
  'postgres:': 'postgres',
  'postgresql:': 'postgres',
  'mysql:': 'mysql',
  'mariadb:': 'mariadb',
  'redis:': 'redis',
  'rediss:': 'redis',
  'mssql:': 'mssql',
  'sqlserver:': 'mssql',
};

const SCHEME_BY_TYPE: Record<string, string> = {
  postgres: 'postgresql',
  mysql: 'mysql',
  mariadb: 'mariadb',
  redis: 'redis',
  mssql: 'sqlserver',
};

const URL_ENV_VARS = [
  'DBDOCK_DB_URL',
  'DATABASE_URL',
  'DATABASE_URI',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'PG_URL',
  'MYSQL_URL',
  'MARIADB_URL',
  'REDIS_URL',
  'MSSQL_URL',
  'DB_URL',
];

export function parseConnectionUrl(input: string): ResolvedConnection {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    throw new Error('Connection URL is empty.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      'Invalid connection URL. Example: postgresql://user:password@host:5432/dbname',
    );
  }
  const proto = url.protocol.toLowerCase();
  if (proto === 'mongodb:' || proto === 'mongodb+srv:') {
    throw new Error(
      'MongoDB is supported for cross-database migration only, not backups. Use `dbdock migrate` instead.',
    );
  }
  const type = PROTOCOL_TYPE[proto];
  if (!type) {
    throw new Error(
      `Unsupported connection protocol "${proto.replace(':', '')}". Supported: postgresql, mysql, mariadb, redis, mssql, sqlserver.`,
    );
  }
  const engine = getEngine(type);
  const port = url.port ? Number.parseInt(url.port, 10) : engine.defaultPort;
  return {
    type,
    host: url.hostname || 'localhost',
    port: Number.isNaN(port) ? engine.defaultPort : port,
    username: url.username
      ? decodeURIComponent(url.username)
      : engine.defaultUser,
    password: url.password ? decodeURIComponent(url.password) : '',
    database: decodeURIComponent((url.pathname || '').replace(/^\//, '')),
  };
}

export interface EnvDetection {
  envVar: string;
  connection: ResolvedConnection;
}

export function detectConnectionUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EnvDetection | null {
  for (const name of URL_ENV_VARS) {
    const value = env[name];
    if (value && value.trim()) {
      try {
        return { envVar: name, connection: parseConnectionUrl(value) };
      } catch {
        continue;
      }
    }
  }
  return null;
}

export interface ConnectionDefaults {
  host?: string;
  port?: number;
  username?: string;
  database?: string;
}

export function detectConnectionVarsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ConnectionDefaults {
  const host = env.DBDOCK_DB_HOST || env.DB_HOST;
  const username = env.DBDOCK_DB_USER || env.DB_USER;
  const database = env.DBDOCK_DB_NAME || env.DB_NAME;
  const portRaw = env.DBDOCK_DB_PORT || env.DB_PORT;
  const port = portRaw ? Number.parseInt(portRaw, 10) : undefined;
  return {
    ...(host ? { host } : {}),
    ...(port !== undefined && !Number.isNaN(port) ? { port } : {}),
    ...(username ? { username } : {}),
    ...(database ? { database } : {}),
  };
}

export function formatConnectionDisplay(
  conn: ResolvedConnection,
  opts: { maskPassword?: boolean } = {},
): string {
  const scheme = SCHEME_BY_TYPE[conn.type] ?? conn.type;
  const secret = opts.maskPassword ? '****' : conn.password;
  const auth = conn.username
    ? `${conn.username}${conn.password ? `:${secret}` : ''}@`
    : '';
  const db = conn.database ? `/${conn.database}` : '';
  return `${scheme}://${auth}${conn.host}:${conn.port}${db}`;
}
