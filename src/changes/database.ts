import { Client } from 'pg';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import type { CLIConfig } from '@/cli/utils/config';
import { targetHash } from '@/changes/storage';

export interface SchemaSnapshot {
  tables: string[];
  columns: Record<string, string>;
}

export interface LocalDatabase {
  schema: () => Promise<SchemaSnapshot>;
  execute(sql: string): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

function quoteIdentifier(value: string, delimiter: string): string {
  return (
    delimiter + value.split(delimiter).join(delimiter + delimiter) + delimiter
  );
}

export async function lockDatabase(config: CLIConfig): Promise<LocalDatabase> {
  const db = config.database;
  const ssl =
    db.sslMode && db.sslMode !== 'disable'
      ? { rejectUnauthorized: true }
      : undefined;
  const identity = targetHash(config);
  if (['postgres', 'postgresql'].includes(db.type)) {
    const client = new Client({
      host: db.host,
      port: db.port,
      user: db.user ?? db.username,
      password: db.password,
      database: db.database,
      ssl,
    });
    await client.connect();
    const key = parseInt(identity.slice(0, 8), 16) | 0;
    const second = parseInt(identity.slice(8, 16), 16) | 0;
    try {
      const lock = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [key, second],
      );
      if (!lock.rows[0]?.locked)
        throw new Error('Another DBDock change is running on this database.');
    } catch (error) {
      await client.end();
      throw error;
    }
    return {
      schema: async () => {
        const result = await client.query<{
          table_schema: string;
          table_name: string;
          column_name: string;
          udt_name: string;
          is_nullable: string;
        }>(
          "SELECT table_schema, table_name, column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema')",
        );
        const columns = Object.fromEntries(
          result.rows.map((row) => [
            JSON.stringify([row.table_schema, row.table_name, row.column_name]),
            `${row.udt_name}:${row.is_nullable}`,
          ]),
        );
        return {
          tables: [
            ...new Set(
              result.rows.map((row) =>
                JSON.stringify([row.table_schema, row.table_name]),
              ),
            ),
          ],
          columns,
        };
      },
      execute: async (sql) => {
        await client.query(sql);
      },
      reset: async () => {
        const schemas = await client.query<{ nspname: string }>(
          "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'",
        );
        await client.query('BEGIN');
        try {
          for (const schema of schemas.rows)
            await client.query(
              `DROP SCHEMA ${quoteIdentifier(schema.nspname, '"')} CASCADE`,
            );
          await client.query('CREATE SCHEMA public');
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      },
      close: async () => {
        await client.end();
      },
    };
  }
  const client = await createConnection({
    host: db.host,
    port: db.port,
    user: db.user ?? db.username,
    password: db.password,
    database: db.database,
    multipleStatements: true,
    ssl,
  });
  try {
    const [lock] = await client.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, 0) AS locked',
      [`dbdock:${identity.slice(0, 48)}`],
    );
    if (lock[0]?.locked !== 1)
      throw new Error('Another DBDock change is running on this database.');
  } catch (error) {
    await client.end();
    throw error;
  }
  return {
    schema: async () => {
      const [rows] = await client.query<RowDataPacket[]>(
        'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()',
      );
      const columns = Object.fromEntries(
        rows.map((row) => [
          JSON.stringify([row.TABLE_NAME, row.COLUMN_NAME]),
          `${String(row.COLUMN_TYPE)}:${String(row.IS_NULLABLE)}`,
        ]),
      );
      return {
        tables: [...new Set(rows.map((row) => String(row.TABLE_NAME)))],
        columns,
      };
    },
    execute: async (sql) => {
      await client.query(sql);
    },
    reset: async () => {
      const [tables] = await client.query<RowDataPacket[]>(
        'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
      );
      const [routines] = await client.query<RowDataPacket[]>(
        'SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()',
      );
      const [events] = await client.query<RowDataPacket[]>(
        'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()',
      );
      await client.query('SET FOREIGN_KEY_CHECKS=0');
      try {
        for (const row of tables)
          await client.query(
            `DROP ${row.TABLE_TYPE === 'VIEW' ? 'VIEW' : 'TABLE'} IF EXISTS ${quoteIdentifier(String(row.TABLE_NAME), '`')}`,
          );
        for (const row of routines)
          await client.query(
            `DROP ${row.ROUTINE_TYPE === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE'} IF EXISTS ${quoteIdentifier(String(row.ROUTINE_NAME), '`')}`,
          );
        for (const row of events)
          await client.query(
            `DROP EVENT IF EXISTS ${quoteIdentifier(String(row.EVENT_NAME), '`')}`,
          );
      } finally {
        await client.query('SET FOREIGN_KEY_CHECKS=1');
      }
    },
    close: async () => {
      await client.end();
    },
  };
}
