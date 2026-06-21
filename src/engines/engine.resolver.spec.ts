import { getEngine, SUPPORTED_ENGINE_TYPES } from './index';
import { postgresEngine } from './postgres.engine';
import { mysqlEngine } from './mysql.engine';
import { mssqlEngine } from './mssql.engine';
import { redisEngine } from './redis.engine';

describe('getEngine', () => {
  it('resolves PostgreSQL and wire-compatible variants to the postgres engine', () => {
    for (const type of [
      'postgres',
      'postgresql',
      'cockroachdb',
      'redshift',
      'timescaledb',
    ]) {
      expect(getEngine(type)).toBe(postgresEngine);
    }
  });

  it('resolves MySQL and MariaDB to the mysql engine', () => {
    expect(getEngine('mysql')).toBe(mysqlEngine);
    expect(getEngine('mariadb')).toBe(mysqlEngine);
  });

  it('resolves SQL Server aliases to the mssql engine', () => {
    expect(getEngine('mssql')).toBe(mssqlEngine);
    expect(getEngine('sqlserver')).toBe(mssqlEngine);
  });

  it('resolves Redis to the redis engine', () => {
    expect(getEngine('redis')).toBe(redisEngine);
  });

  it('is case-insensitive and defaults to postgres when type is missing', () => {
    expect(getEngine('MySQL')).toBe(mysqlEngine);
    expect(getEngine('REDIS')).toBe(redisEngine);
    expect(getEngine(undefined)).toBe(postgresEngine);
  });

  it('throws a helpful error for unsupported engines', () => {
    expect(() => getEngine('cassandra')).toThrow(
      /Unsupported database type "cassandra"/,
    );
    expect(() => getEngine('cassandra')).toThrow(
      new RegExp(
        SUPPORTED_ENGINE_TYPES.join(', ').replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        ),
      ),
    );
  });
});

describe('engine metadata', () => {
  it('exposes the correct default ports', () => {
    expect(postgresEngine.defaultPort).toBe(5432);
    expect(mysqlEngine.defaultPort).toBe(3306);
    expect(mssqlEngine.defaultPort).toBe(1433);
    expect(redisEngine.defaultPort).toBe(6379);
  });

  it('exposes the correct default users', () => {
    expect(postgresEngine.defaultUser).toBe('postgres');
    expect(mysqlEngine.defaultUser).toBe('root');
    expect(mssqlEngine.defaultUser).toBe('sa');
    expect(redisEngine.defaultUser).toBe('default');
  });

  it('maps backup formats to file extensions', () => {
    expect(postgresEngine.fileExtension('custom')).toBe('sql');
    expect(postgresEngine.fileExtension('directory')).toBe('dir');
    expect(postgresEngine.fileExtension('tar')).toBe('tar');
    expect(mysqlEngine.fileExtension()).toBe('sql');
    expect(mysqlEngine.fileExtension('directory')).toBe('sql');
    expect(mssqlEngine.fileExtension()).toBe('sql');
    expect(redisEngine.fileExtension()).toBe('redis');
  });
});
