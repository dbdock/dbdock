import { DatabaseEngine } from './engine.types';
import { postgresEngine } from './postgres.engine';
import { mysqlEngine } from './mysql.engine';
import { mssqlEngine } from './mssql.engine';
import { redisEngine } from './redis.engine';

const ENGINE_BY_TYPE: Record<string, DatabaseEngine> = {
  postgres: postgresEngine,
  postgresql: postgresEngine,
  cockroachdb: postgresEngine,
  redshift: postgresEngine,
  timescaledb: postgresEngine,
  mysql: mysqlEngine,
  mariadb: mysqlEngine,
  mssql: mssqlEngine,
  sqlserver: mssqlEngine,
  redis: redisEngine,
};

export const SUPPORTED_ENGINE_TYPES = Object.keys(ENGINE_BY_TYPE);

export function getEngine(type: string | undefined): DatabaseEngine {
  const engine = ENGINE_BY_TYPE[(type || 'postgres').toLowerCase()];
  if (!engine) {
    throw new Error(
      `Unsupported database type "${type}". ` +
        `Backup and restore currently support: ${SUPPORTED_ENGINE_TYPES.join(', ')}.`,
    );
  }
  return engine;
}

export type {
  DatabaseEngine,
  DbConnection,
  DatabaseStats,
  DumpHandle,
} from './engine.types';
