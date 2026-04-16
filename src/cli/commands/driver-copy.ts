import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import ora, { Ora } from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { logger } from '../utils/logger';
import { URL } from 'url';

const DEFAULT_BATCH_SIZE = 1000;
const MAX_PARAMS = 65000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

interface DriverCopyOptions {
  schemaOnly?: boolean;
  dataOnly?: boolean;
  verbose?: boolean;
}

interface DbConnectionInfo {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  connectionString: string;
}

interface EnumDef {
  name: string;
  values: string[];
}

interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  identity: string;
  isGenerated: boolean;
}

interface PrimaryKeyDef {
  constraintName: string;
  columns: string[];
}

interface UniqueConstraintDef {
  constraintName: string;
  columns: string[];
}

interface ForeignKeyDef {
  constraintName: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string;
  onUpdate: string;
}

interface IndexDef {
  name: string;
  definition: string;
}

interface TableDef {
  name: string;
  columns: ColumnDef[];
  primaryKey: PrimaryKeyDef | null;
  uniqueConstraints: UniqueConstraintDef[];
  foreignKeys: ForeignKeyDef[];
  indexes: IndexDef[];
  rowCount: number;
}

function parsePostgresUrl(urlString: string): DbConnectionInfo {
  const url = new URL(urlString);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(
      `Invalid protocol "${url.protocol}". Expected "postgresql://" or "postgres://"`,
    );
  }
  return {
    host: url.hostname || 'localhost',
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password || ''),
    database: url.pathname.replace(/^\//, '') || 'postgres',
    connectionString: urlString,
  };
}

function maskPassword(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return url;
  }
}

async function getTableNames(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return result.rows.map((r) => r.table_name);
}

async function getEnums(client: PoolClient): Promise<EnumDef[]> {
  try {
    const result = await client.query<EnumDef>(`
      SELECT t.typname AS name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public'
      GROUP BY t.typname
      ORDER BY t.typname
    `);
    return result.rows;
  } catch {
    return [];
  }
}

interface ColumnRow {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
  identity: string;
  generated: string;
}

async function getColumns(
  client: PoolClient,
  tableName: string,
): Promise<ColumnDef[]> {
  const result = await client.query<ColumnRow>(
    `
    SELECT
      a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS type,
      NOT a.attnotnull AS nullable,
      pg_get_expr(d.adbin, d.adrelid) AS default_value,
      COALESCE(a.attidentity, '') AS identity,
      COALESCE(a.attgenerated, '') AS generated
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE a.attrelid = (
      SELECT c.oid FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1 AND n.nspname = 'public'
    )
    AND a.attnum > 0
    AND NOT a.attisdropped
    ORDER BY a.attnum
  `,
    [tableName],
  );

  return result.rows.map((r) => ({
    name: r.name,
    type: r.type,
    nullable: r.nullable,
    defaultValue: r.default_value,
    identity: r.identity,
    isGenerated: r.generated !== '',
  }));
}

interface ConstraintRow {
  constraint_name: string;
  columns: string[];
}

async function getPrimaryKey(
  client: PoolClient,
  tableName: string,
): Promise<PrimaryKeyDef | null> {
  const result = await client.query<ConstraintRow>(
    `
    SELECT
      con.conname AS constraint_name,
      (SELECT array_agg(a.attname ORDER BY k.n)
       FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, n)
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      ) AS columns
    FROM pg_constraint con
    WHERE con.conrelid = (
      SELECT c.oid FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1 AND n.nspname = 'public'
    )
    AND con.contype = 'p'
  `,
    [tableName],
  );

  if (result.rows.length === 0) return null;
  return {
    constraintName: result.rows[0].constraint_name,
    columns: result.rows[0].columns,
  };
}

async function getUniqueConstraints(
  client: PoolClient,
  tableName: string,
): Promise<UniqueConstraintDef[]> {
  const result = await client.query<ConstraintRow>(
    `
    SELECT
      con.conname AS constraint_name,
      (SELECT array_agg(a.attname ORDER BY k.n)
       FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, n)
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      ) AS columns
    FROM pg_constraint con
    WHERE con.conrelid = (
      SELECT c.oid FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1 AND n.nspname = 'public'
    )
    AND con.contype = 'u'
  `,
    [tableName],
  );

  return result.rows.map((r) => ({
    constraintName: r.constraint_name,
    columns: r.columns,
  }));
}

interface ForeignKeyRow {
  constraint_name: string;
  columns: string[];
  referenced_table: string;
  referenced_columns: string[];
  on_delete: string;
  on_update: string;
}

async function getForeignKeys(
  client: PoolClient,
  tableName: string,
): Promise<ForeignKeyDef[]> {
  const result = await client.query<ForeignKeyRow>(
    `
    SELECT
      con.conname AS constraint_name,
      (SELECT array_agg(a.attname ORDER BY k.n)
       FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, n)
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      ) AS columns,
      ref_cls.relname AS referenced_table,
      (SELECT array_agg(a.attname ORDER BY k.n)
       FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, n)
       JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
      ) AS referenced_columns,
      con.confdeltype AS on_delete,
      con.confupdtype AS on_update
    FROM pg_constraint con
    JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
    WHERE con.conrelid = (
      SELECT c.oid FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1 AND n.nspname = 'public'
    )
    AND con.contype = 'f'
  `,
    [tableName],
  );

  const actionMap: Record<string, string> = {
    a: 'NO ACTION',
    r: 'RESTRICT',
    c: 'CASCADE',
    n: 'SET NULL',
    d: 'SET DEFAULT',
  };

  return result.rows.map((r) => ({
    constraintName: r.constraint_name,
    columns: r.columns,
    referencedTable: r.referenced_table,
    referencedColumns: r.referenced_columns,
    onDelete: actionMap[r.on_delete] || 'NO ACTION',
    onUpdate: actionMap[r.on_update] || 'NO ACTION',
  }));
}

async function getIndexes(
  client: PoolClient,
  tableName: string,
): Promise<IndexDef[]> {
  const result = await client.query<{ name: string; definition: string }>(
    `
    SELECT
      i.indexname AS name,
      i.indexdef AS definition
    FROM pg_indexes i
    JOIN pg_class c ON c.relname = i.indexname
    JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = i.schemaname
    JOIN pg_index ix ON ix.indexrelid = c.oid
    WHERE i.tablename = $1
      AND i.schemaname = 'public'
      AND NOT ix.indisprimary
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        WHERE con.conindid = c.oid AND con.contype IN ('p', 'u')
      )
  `,
    [tableName],
  );

  return result.rows.map((r) => ({
    name: r.name,
    definition: r.definition,
  }));
}

async function getRowCount(
  client: PoolClient,
  tableName: string,
): Promise<number> {
  const result = await client.query<{ estimate: string }>(
    `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1`,
    [tableName],
  );
  const estimate = parseInt(result.rows[0]?.estimate || '0');

  if (estimate < 10000) {
    const exact = await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM "public"."${tableName}"`,
    );
    return Number(exact.rows[0]?.count ?? 0);
  }

  return Math.max(estimate, 0);
}

async function introspectTable(
  client: PoolClient,
  tableName: string,
): Promise<TableDef> {
  const [
    columns,
    primaryKey,
    uniqueConstraints,
    foreignKeys,
    indexes,
    rowCount,
  ] = await Promise.all([
    getColumns(client, tableName),
    getPrimaryKey(client, tableName),
    getUniqueConstraints(client, tableName),
    getForeignKeys(client, tableName),
    getIndexes(client, tableName),
    getRowCount(client, tableName),
  ]);

  return {
    name: tableName,
    columns,
    primaryKey,
    uniqueConstraints,
    foreignKeys,
    indexes,
    rowCount,
  };
}

export function topologicalSort(tables: TableDef[]): TableDef[] {
  const tableMap = new Map<string, TableDef>();
  for (const t of tables) tableMap.set(t.name, t);

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const sorted: TableDef[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);

    const table = tableMap.get(name);
    if (table) {
      for (const fk of table.foreignKeys) {
        if (fk.referencedTable !== name && tableMap.has(fk.referencedTable)) {
          visit(fk.referencedTable);
        }
      }
    }

    visiting.delete(name);
    visited.add(name);
    if (table) sorted.push(table);
  }

  for (const t of tables) visit(t.name);
  return sorted;
}

export function generateColumnDDL(col: ColumnDef): string {
  let ddl = `"${col.name}" `;
  const isSerial = col.defaultValue && col.defaultValue.startsWith('nextval(');

  if (col.identity === 'a') {
    const baseType = col.type.includes('bigint')
      ? 'bigint'
      : col.type.includes('smallint')
        ? 'smallint'
        : 'integer';
    ddl += `${baseType} GENERATED ALWAYS AS IDENTITY`;
    return ddl;
  }

  if (col.identity === 'd') {
    const baseType = col.type.includes('bigint')
      ? 'bigint'
      : col.type.includes('smallint')
        ? 'smallint'
        : 'integer';
    ddl += `${baseType} GENERATED BY DEFAULT AS IDENTITY`;
    return ddl;
  }

  if (isSerial) {
    if (col.type.includes('bigint')) {
      ddl += 'bigserial';
    } else if (col.type.includes('smallint')) {
      ddl += 'smallserial';
    } else {
      ddl += 'serial';
    }
    return ddl;
  }

  ddl += col.type;
  if (col.defaultValue) {
    ddl += ` DEFAULT ${col.defaultValue}`;
  }
  if (!col.nullable) {
    ddl += ' NOT NULL';
  }

  return ddl;
}

export function generateCreateTableDDL(table: TableDef): string {
  const nonGenerated = table.columns.filter((c) => !c.isGenerated);
  const columnDefs = nonGenerated.map(generateColumnDDL);

  if (table.primaryKey) {
    columnDefs.push(
      `CONSTRAINT "${table.primaryKey.constraintName}" PRIMARY KEY (${table.primaryKey.columns.map((c) => `"${c}"`).join(', ')})`,
    );
  }

  for (const uq of table.uniqueConstraints) {
    columnDefs.push(
      `CONSTRAINT "${uq.constraintName}" UNIQUE (${uq.columns.map((c) => `"${c}"`).join(', ')})`,
    );
  }

  return `CREATE TABLE "public"."${table.name}" (\n  ${columnDefs.join(',\n  ')}\n)`;
}

export function generateForeignKeyDDL(table: TableDef): string[] {
  return table.foreignKeys.map((fk) => {
    const cols = fk.columns.map((c) => `"${c}"`).join(', ');
    const refCols = fk.referencedColumns.map((c) => `"${c}"`).join(', ');
    return `ALTER TABLE "public"."${table.name}" ADD CONSTRAINT "${fk.constraintName}" FOREIGN KEY (${cols}) REFERENCES "public"."${fk.referencedTable}" (${refCols}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryWithRetry<T extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await pool.query<T>(sql, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        msg.includes('connection') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('terminating') ||
        msg.includes('too many clients') ||
        msg.includes('initialization');

      if (!isRetryable || attempt === MAX_RETRIES) throw err;

      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw new Error('queryWithRetry: exhausted retries');
}

async function copyTableData(
  sourcePool: Pool,
  targetPool: Pool,
  table: TableDef,
  spinner: Ora,
): Promise<number> {
  const copyColumns = table.columns.filter((c) => !c.isGenerated);
  if (copyColumns.length === 0) return 0;

  const columnNames = copyColumns.map((c) => `"${c.name}"`);
  const columnList = columnNames.join(', ');
  const batchSize = Math.min(
    DEFAULT_BATCH_SIZE,
    Math.floor(MAX_PARAMS / copyColumns.length),
  );

  const hasAlwaysIdentity = copyColumns.some((c) => c.identity === 'a');

  let totalCopied = 0;
  const cursorName = `dbdock_cursor_${table.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const sourceClient = await sourcePool.connect();

  try {
    await sourceClient.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    );
    await sourceClient.query(
      `DECLARE "${cursorName}" NO SCROLL CURSOR FOR SELECT ${columnList} FROM "public"."${table.name}"`,
    );

    while (true) {
      const result = await sourceClient.query<Record<string, unknown>>(
        `FETCH ${batchSize} FROM "${cursorName}"`,
      );

      if (result.rows.length === 0) break;

      const rows = result.rows;
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      for (const row of rows) {
        const rowPlaceholders: string[] = [];
        for (const col of copyColumns) {
          rowPlaceholders.push(`$${paramIdx++}`);
          values.push(row[col.name]);
        }
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
      }

      let insertSQL: string;
      if (hasAlwaysIdentity) {
        insertSQL = `INSERT INTO "public"."${table.name}" (${columnList}) OVERRIDING SYSTEM VALUE VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;
      } else {
        insertSQL = `INSERT INTO "public"."${table.name}" (${columnList}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;
      }

      await queryWithRetry(targetPool, insertSQL, values);
      totalCopied += rows.length;
      spinner.text = `  Copying ${table.name}... ${totalCopied.toLocaleString()} rows`;

      if (rows.length < batchSize) break;
    }

    await sourceClient.query(`CLOSE "${cursorName}"`);
    await sourceClient.query('COMMIT');
  } catch (err) {
    await sourceClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    sourceClient.release();
  }

  return totalCopied;
}

async function resetSequences(
  client: PoolClient,
  tables: TableDef[],
): Promise<void> {
  for (const table of tables) {
    for (const col of table.columns) {
      const isSerial =
        col.defaultValue && col.defaultValue.startsWith('nextval(');
      const isIdentity = col.identity !== '';

      if (!isSerial && !isIdentity) continue;

      try {
        const maxResult = await client.query<{ max_val: string }>(
          `SELECT COALESCE(MAX("${col.name}"), 0)::bigint AS max_val FROM "public"."${table.name}"`,
        );
        const maxVal = parseInt(maxResult.rows[0]?.max_val || '0');

        if (maxVal <= 0) continue;

        if (isIdentity) {
          await client.query(
            `ALTER TABLE "public"."${table.name}" ALTER COLUMN "${col.name}" RESTART WITH ${maxVal + 1}`,
          );
        } else {
          const seqResult = await client.query<{ seq_name: string | null }>(
            `SELECT pg_get_serial_sequence($1, $2) AS seq_name`,
            [`public.${table.name}`, col.name],
          );
          const seqName = seqResult.rows[0]?.seq_name;
          if (seqName) {
            await client.query(`SELECT setval($1, $2, true)`, [
              seqName,
              maxVal,
            ]);
          }
        }
      } catch {
        // Non-critical
      }
    }
  }
}

export async function driverCopyCommand(
  sourceUrl: string,
  targetUrl: string,
  options: DriverCopyOptions,
): Promise<void> {
  console.log('');
  console.log(chalk.bold('  DBDock - Database Copy (Driver Mode)'));
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log(
    chalk.gray('  Using direct PostgreSQL driver — no pg_dump required'),
  );
  console.log('');

  let source: DbConnectionInfo;
  let target: DbConnectionInfo;

  try {
    source = parsePostgresUrl(sourceUrl);
  } catch (error) {
    logger.error(
      `Source URL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  try {
    target = parsePostgresUrl(targetUrl);
  } catch (error) {
    logger.error(
      `Target URL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  if (sourceUrl === targetUrl) {
    logger.error('Source and target URLs cannot be the same');
    process.exit(1);
  }

  const sourcePool = new Pool({
    connectionString: source.connectionString,
    max: 2,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    query_timeout: 120000,
    statement_timeout: 120000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  const targetPool = new Pool({
    connectionString: target.connectionString,
    max: 4,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    query_timeout: 120000,
    statement_timeout: 120000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  const connSpinner = ora('Testing connections...').start();
  try {
    await Promise.all([
      sourcePool.query('SELECT 1'),
      targetPool.query('SELECT 1'),
    ]);
    connSpinner.succeed('Both connections verified');
  } catch (error) {
    connSpinner.fail('Connection test failed');
    logger.error(error instanceof Error ? error.message : String(error));
    await sourcePool.end();
    await targetPool.end();
    process.exit(1);
  }

  const introSpinner = ora('Introspecting source schema...').start();
  let tables: TableDef[] = [];
  let enums: EnumDef[] = [];

  const sourceClient = await sourcePool.connect();
  try {
    const tableNames = await getTableNames(sourceClient);
    enums = await getEnums(sourceClient);

    for (const name of tableNames) {
      introSpinner.text = `Introspecting ${name}...`;
      const table = await introspectTable(sourceClient, name);
      tables.push(table);
    }
  } catch (error) {
    introSpinner.fail('Schema introspection failed');
    logger.error(error instanceof Error ? error.message : String(error));
    sourceClient.release();
    await sourcePool.end();
    await targetPool.end();
    process.exit(1);
  } finally {
    sourceClient.release();
  }

  let sortedTables = topologicalSort(tables);
  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
  const totalFks = tables.reduce((sum, t) => sum + t.foreignKeys.length, 0);
  const totalIndexes = tables.reduce((sum, t) => sum + t.indexes.length, 0);

  introSpinner.succeed(
    `Found ${tables.length} table(s), ${enums.length} enum(s), ~${totalRows.toLocaleString()} rows`,
  );

  console.log('');
  logger.info('Source Database:');
  logger.log(`  Host:     ${source.host}:${source.port}`);
  logger.log(`  Database: ${source.database}`);
  logger.log(`  User:     ${source.user}`);
  logger.log(`  Tables:   ${tables.length}`);
  logger.log(`  FKs:      ${totalFks}`);
  logger.log(`  Indexes:  ${totalIndexes}`);

  console.log('');
  logger.info('Target Database:');
  logger.log(`  Host:     ${target.host}:${target.port}`);
  logger.log(`  Database: ${target.database}`);
  logger.log(`  User:     ${target.user}`);

  console.log('');
  let mode = 'Full copy (schema + data)';
  if (options.schemaOnly) mode = 'Schema only';
  if (options.dataOnly) mode = 'Data only';
  logger.info(`Mode: ${mode}`);

  console.log('');
  const { tableScope } = (await inquirer.prompt([
    {
      type: 'list',
      name: 'tableScope',
      message: 'Which tables should be migrated?',
      choices: [
        {
          name: `All tables (${sortedTables.length})`,
          value: 'all',
        },
        {
          name: 'Choose tables (space to toggle)',
          value: 'pick',
        },
      ],
    },
  ])) as { tableScope: 'all' | 'pick' };

  let selectedTables: string[];
  if (tableScope === 'all') {
    selectedTables = sortedTables.map((t) => t.name);
  } else {
    const pick = (await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedTables',
        message: 'Select tables to copy (space to toggle, enter to confirm):',
        choices: sortedTables.map((t) => ({
          name: `${t.name} (${t.columns.length} cols, ~${t.rowCount.toLocaleString()} rows)`,
          value: t.name,
          checked: true,
        })),
        pageSize: 20,
      },
    ])) as { selectedTables: string[] };
    selectedTables = pick.selectedTables;
  }

  if (selectedTables.length === 0) {
    logger.warn('No tables selected');
    await sourcePool.end();
    await targetPool.end();
    return;
  }

  const selectedSet = new Set<string>(selectedTables);
  const allTableCount = sortedTables.length;
  sortedTables = sortedTables.filter((t) => selectedSet.has(t.name));
  tables = tables.filter((t) => selectedSet.has(t.name));

  const usedTypes = new Set<string>();
  for (const t of sortedTables) {
    for (const c of t.columns) {
      usedTypes.add(c.type);
    }
  }
  enums = enums.filter((e) => usedTypes.has(e.name));

  for (const t of sortedTables) {
    t.foreignKeys = t.foreignKeys.filter((fk) =>
      selectedSet.has(fk.referencedTable),
    );
  }

  const selectedRows = sortedTables.reduce((sum, t) => sum + t.rowCount, 0);
  if (tableScope === 'all') {
    logger.info(
      `Migrating all ${sortedTables.length} table(s), ~${selectedRows.toLocaleString()} rows`,
    );
  } else {
    logger.info(
      `Selected ${sortedTables.length}/${allTableCount} table(s), ~${selectedRows.toLocaleString()} rows`,
    );
  }

  console.log('');
  const { confirm } = (await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Copy ${selectedTables.length} table(s) from ${source.database} → ${target.database}?`,
      default: false,
    },
  ])) as { confirm: boolean };

  if (!confirm) {
    logger.warn('Copy cancelled');
    await sourcePool.end();
    await targetPool.end();
    return;
  }

  console.log('');
  const startTime = Date.now();

  const targetClient = await targetPool.connect();
  try {
    if (!options.dataOnly) {
      const schemaSpinner = ora('Preparing target database...').start();

      for (const table of [...sortedTables].reverse()) {
        await targetClient.query(
          `DROP TABLE IF EXISTS "public"."${table.name}" CASCADE`,
        );
      }

      for (const enumDef of enums) {
        await targetClient.query(
          `DROP TYPE IF EXISTS "public"."${enumDef.name}" CASCADE`,
        );
        const values = enumDef.values
          .map((v) => `'${v.replace(/'/g, "''")}'`)
          .join(', ');
        await targetClient.query(
          `CREATE TYPE "public"."${enumDef.name}" AS ENUM (${values})`,
        );
      }

      for (const table of sortedTables) {
        schemaSpinner.text = `Creating ${table.name}...`;
        const ddl = generateCreateTableDDL(table);
        if (options.verbose) {
          logger.log(`\n${chalk.gray(ddl)}`);
        }
        await targetClient.query(ddl);
      }

      for (const table of sortedTables) {
        for (const idx of table.indexes) {
          try {
            await targetClient.query(idx.definition);
          } catch (err) {
            if (options.verbose) {
              logger.warn(
                `  Index ${idx.name} skipped: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
      }

      schemaSpinner.succeed(
        `Schema created (${sortedTables.length} tables, ${enums.length} enums, ${totalIndexes} indexes)`,
      );
    } else {
      const truncSpinner = ora('Truncating target tables...').start();
      const tableNames = sortedTables
        .map((t) => `"public"."${t.name}"`)
        .join(', ');
      if (tableNames) {
        await targetClient.query(`TRUNCATE ${tableNames} CASCADE`);
      }
      truncSpinner.succeed('Target tables truncated');
    }

    if (!options.schemaOnly) {
      console.log('');
      let tableIdx = 0;
      let grandTotal = 0;

      for (const table of sortedTables) {
        tableIdx++;
        const prefix = `  [${tableIdx}/${sortedTables.length}]`;
        const dataSpinner = ora(`${prefix} Copying ${table.name}...`).start();

        try {
          const count = await copyTableData(
            sourcePool,
            targetPool,
            table,
            dataSpinner,
          );
          grandTotal += count;
          dataSpinner.succeed(
            `${prefix} ${table.name}: ${count.toLocaleString()} rows`,
          );
        } catch (err) {
          dataSpinner.fail(
            `${prefix} ${table.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const seqSpinner = ora('Resetting sequences...').start();
      await resetSequences(targetClient, sortedTables);
      seqSpinner.succeed('Sequences reset');

      console.log('');
      logger.info(`Total rows copied: ${grandTotal.toLocaleString()}`);
    }

    if (!options.dataOnly) {
      const fkSpinner = ora('Adding foreign key constraints...').start();
      let fkCount = 0;
      let fkFailed = 0;

      for (const table of sortedTables) {
        const fkDDLs = generateForeignKeyDDL(table);
        for (const ddl of fkDDLs) {
          try {
            await targetClient.query(ddl);
            fkCount++;
          } catch (err) {
            fkFailed++;
            if (options.verbose) {
              logger.warn(
                `  FK failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
      }

      if (fkFailed > 0) {
        fkSpinner.warn(
          `${fkCount} FK(s) added, ${fkFailed} failed (use --verbose for details)`,
        );
      } else {
        fkSpinner.succeed(`${fkCount} foreign key constraint(s) added`);
      }
    }
  } finally {
    targetClient.release();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('');
  logger.success(`Database copied successfully in ${elapsed}s`);
  console.log('');
  logger.info('Target connection:');
  logger.log(`  ${maskPassword(targetUrl)}`);
  console.log('');

  await sourcePool.end();
  await targetPool.end();
}
