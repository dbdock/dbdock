import type { SslMode } from '@/cli/utils/config';

const SSL_MODES: SslMode[] = [
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
];

export interface PostgresConfigFromUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parsePostgresUrlToConfig(
  urlString: string,
): PostgresConfigFromUrl {
  const url = new URL(urlString);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(
      `Invalid protocol "${url.protocol}". Expected "postgresql://" or "postgres://"`,
    );
  }
  const database = (url.pathname || '/').replace(/^\//, '') || 'postgres';
  const port = parseInt(url.port || '5432', 10);
  return {
    host: url.hostname || 'localhost',
    port: Number.isNaN(port) ? 5432 : port,
    user: url.username ? decodeURIComponent(url.username) : 'postgres',
    password: url.password ? decodeURIComponent(url.password) : '',
    database: database,
  };
}

export function parseDatabaseUrl(
  urlString: string,
): PostgresConfigFromUrl & { type: string; sslMode?: SslMode } {
  const url = new URL(urlString);
  const mysql = url.protocol === 'mysql:' || url.protocol === 'mariadb:';
  if (!mysql && url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    throw new Error('DATABASE_URL must use PostgreSQL, MySQL or MariaDB.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must name a database.');
  const rawSslMode = url.searchParams.get('sslmode') ?? undefined;
  if (rawSslMode && !SSL_MODES.includes(rawSslMode as SslMode))
    throw new Error(`DATABASE_URL has an unknown sslmode: ${rawSslMode}`);
  const sslMode = rawSslMode as SslMode | undefined;
  return {
    type: mysql
      ? url.protocol === 'mariadb:'
        ? 'mariadb'
        : 'mysql'
      : 'postgresql',
    host: url.hostname,
    port: Number(url.port || (mysql ? 3306 : 5432)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslMode,
  };
}

export function getDbUrlFromEnv(): string | undefined {
  return process.env.DBDOCK_DB_URL || process.env.DATABASE_URL;
}

type MutableConfig = Record<string, unknown> & {
  postgres?: Record<string, unknown>;
  database?: Record<string, unknown>;
};

function cloneConfig(config: Record<string, unknown>): MutableConfig {
  return JSON.parse(JSON.stringify(config)) as MutableConfig;
}

export function applyDbUrlToPostgresConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const url = getDbUrlFromEnv();
  if (!url || !url.trim()) return config;
  const parsed = parsePostgresUrlToConfig(url);
  const merged = cloneConfig(config);
  if (!merged.postgres) merged.postgres = {};
  merged.postgres.host = parsed.host;
  merged.postgres.port = parsed.port;
  merged.postgres.user = parsed.user;
  merged.postgres.password = parsed.password;
  merged.postgres.database = parsed.database;
  return merged;
}

export function applyDbUrlToCliDatabase(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const url = getDbUrlFromEnv();
  if (!url || !url.trim()) return config;
  const parsed = parseDatabaseUrl(url);
  const merged = cloneConfig(config);
  if (!merged.database) merged.database = {};
  merged.database.type = parsed.type;
  merged.database.sslMode = parsed.sslMode;
  merged.database.host = parsed.host;
  merged.database.port = parsed.port;
  merged.database.username = parsed.user;
  merged.database.user = parsed.user;
  merged.database.password = parsed.password;
  merged.database.database = parsed.database;
  return merged;
}
