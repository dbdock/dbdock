import { Pool } from 'pg';
import {
  PgAnalysisResult,
  PgTableAnalysis,
  PgColumnInfo,
  PgForeignKey,
  PgIndexInfo,
  ParsedDatabaseUrl,
} from '../types';

export function parsePostgresUrl(urlString: string): ParsedDatabaseUrl {
  const url = new URL(urlString);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(
      `Invalid protocol "${url.protocol}". Expected "postgresql://" or "postgres://"`,
    );
  }
  const database = url.pathname.replace(/^\//, '') || 'postgres';
  return {
    type: 'postgresql',
    url: urlString,
    database,
    host: url.hostname || 'localhost',
    port: parseInt(url.port || '5432'),
  };
}

export async function analyzePostgres(
  connectionUrl: string,
): Promise<PgAnalysisResult> {
  const parsed = parsePostgresUrl(connectionUrl);
  const pool = new Pool({ connectionString: connectionUrl });

  try {
    const tableNames = await getTableNames(pool);
    const tables: PgTableAnalysis[] = [];
    let totalRows = 0;

    for (const tableName of tableNames) {
      const analysis = await analyzeTable(pool, tableName);
      tables.push(analysis);
      totalRows += analysis.rowCount;
    }

    return {
      database: parsed.database,
      type: 'postgresql',
      tables,
      totalRows,
    };
  } finally {
    await pool.end();
  }
}

async function getTableNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return result.rows.map((r) => r.table_name);
}

interface PgColumnRow {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  is_primary_key: boolean;
  is_unique: boolean;
}

interface PgForeignKeyRow {
  constraint_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
}

interface PgIndexRow {
  index_name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
}

async function analyzeTable(
  pool: Pool,
  tableName: string,
): Promise<PgTableAnalysis> {
  const [columns, foreignKeys, indexes, rowCount] = await Promise.all([
    getColumns(pool, tableName),
    getForeignKeys(pool, tableName),
    getIndexes(pool, tableName),
    getRowCount(pool, tableName),
  ]);

  return {
    name: tableName,
    schema: 'public',
    columns,
    foreignKeys,
    indexes,
    rowCount,
  };
}

async function getColumns(
  pool: Pool,
  tableName: string,
): Promise<PgColumnInfo[]> {
  const result = await pool.query<PgColumnRow>(
    `
    SELECT
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default,
      c.character_maximum_length,
      c.numeric_precision,
      COALESCE(pk.is_pk, false) AS is_primary_key,
      COALESCE(uq.is_unique, false) AS is_unique
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.column_name, true AS is_pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = $1
        AND tc.table_schema = 'public'
        AND tc.constraint_type = 'PRIMARY KEY'
    ) pk ON pk.column_name = c.column_name
    LEFT JOIN (
      SELECT kcu.column_name, true AS is_unique
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = $1
        AND tc.table_schema = 'public'
        AND tc.constraint_type = 'UNIQUE'
    ) uq ON uq.column_name = c.column_name
    WHERE c.table_name = $1
      AND c.table_schema = 'public'
    ORDER BY c.ordinal_position
  `,
    [tableName],
  );

  return result.rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
    udtName: r.udt_name,
    isNullable: r.is_nullable === 'YES',
    columnDefault: r.column_default,
    isPrimaryKey: r.is_primary_key === true,
    isUnique: r.is_unique === true,
    characterMaxLength: r.character_maximum_length,
    numericPrecision: r.numeric_precision,
  }));
}

async function getForeignKeys(
  pool: Pool,
  tableName: string,
): Promise<PgForeignKey[]> {
  const result = await pool.query<PgForeignKeyRow>(
    `
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_name = $1
      AND tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
  `,
    [tableName],
  );

  return result.rows.map((r) => ({
    constraintName: r.constraint_name,
    columnName: r.column_name,
    referencedTable: r.referenced_table,
    referencedColumn: r.referenced_column,
  }));
}

async function getIndexes(
  pool: Pool,
  tableName: string,
): Promise<PgIndexInfo[]> {
  const result = await pool.query<PgIndexRow>(
    `
    SELECT
      i.relname AS index_name,
      array_agg(a.attname ORDER BY k.n) AS columns,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE t.relname = $1
      AND n.nspname = 'public'
    GROUP BY i.relname, ix.indisunique, ix.indisprimary
  `,
    [tableName],
  );

  return result.rows.map((r) => ({
    name: r.index_name,
    columns: r.columns,
    isUnique: r.is_unique,
    isPrimary: r.is_primary,
  }));
}

async function getRowCount(pool: Pool, tableName: string): Promise<number> {
  const result = await pool.query<{ estimate: string }>(
    `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1`,
    [tableName],
  );
  const estimate = parseInt(result.rows[0]?.estimate || '0');

  if (estimate < 10000) {
    const exact = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM "${tableName}"`,
    );
    return Number(exact.rows[0]?.count ?? 0);
  }

  return Math.max(estimate, 0);
}
