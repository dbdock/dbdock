export interface PostgresConfigFromUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parsePostgresUrlToConfig(urlString: string): PostgresConfigFromUrl {
  const url = new URL(urlString);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`Invalid protocol "${url.protocol}". Expected "postgresql://" or "postgres://"`);
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

export function getDbUrlFromEnv(): string | undefined {
  return process.env.DBDOCK_DB_URL || process.env.DATABASE_URL;
}

export function applyDbUrlToPostgresConfig(config: Record<string, unknown>): Record<string, unknown> {
  const url = getDbUrlFromEnv();
  if (!url || !url.trim()) return config;
  const parsed = parsePostgresUrlToConfig(url);
  const merged = JSON.parse(JSON.stringify(config));
  if (!merged.postgres) merged.postgres = {};
  merged.postgres.host = parsed.host;
  merged.postgres.port = parsed.port;
  merged.postgres.user = parsed.user;
  merged.postgres.password = parsed.password;
  merged.postgres.database = parsed.database;
  return merged;
}

export function applyDbUrlToCliDatabase(config: Record<string, unknown>): Record<string, unknown> {
  const url = getDbUrlFromEnv();
  if (!url || !url.trim()) return config;
  const parsed = parsePostgresUrlToConfig(url);
  const merged = JSON.parse(JSON.stringify(config));
  if (!merged.database) merged.database = {};
  merged.database.host = parsed.host;
  merged.database.port = parsed.port;
  merged.database.username = parsed.user;
  merged.database.user = parsed.user;
  merged.database.password = parsed.password;
  merged.database.database = parsed.database;
  return merged;
}
