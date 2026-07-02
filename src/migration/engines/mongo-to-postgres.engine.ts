import { MongoClient, Db, Filter } from 'mongodb';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import {
  MigrationPlan,
  TableMapping,
  FieldMapping,
  NestedMapping,
  ArrayMapping,
  MigrationResult,
  TableMigrationResult,
} from '../types';
import { MongoDocument } from '../row.types';
import { objectIdToUuid, coerceValue } from '../type.mapper';

interface MigrationError {
  table: string;
  sourceId: string;
  error: string;
  data?: unknown;
}

export async function executeMongoToPostgres(
  plan: MigrationPlan,
  onProgress?: (table: string, processed: number, total: number) => void,
): Promise<MigrationResult> {
  const startTime = Date.now();
  const errors: MigrationError[] = [];
  const results: TableMigrationResult[] = [];
  const schema = plan.options.dryRun ? '_dbdock_dryrun' : 'public';

  const mongoClient = new MongoClient(plan.source.url);
  const pgPool = new Pool({ connectionString: plan.target.url });

  try {
    await mongoClient.connect();
    const db = mongoClient.db(plan.source.database);
    const pgClient = await pgPool.connect();

    try {
      if (plan.options.dryRun) {
        await pgClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await pgClient.query(`CREATE SCHEMA ${schema}`);
      }

      if (plan.options.createErrorsTable) {
        await createErrorsTable(pgClient, schema);
      }

      await createAllTables(pgClient, plan.tableMappings || [], schema);

      for (const mapping of plan.tableMappings || []) {
        const result = await migrateCollection(
          db,
          pgClient,
          mapping,
          plan,
          schema,
          errors,
          onProgress,
        );
        results.push(result);
      }

      await addForeignKeys(pgClient, plan.tableMappings || [], schema);

      if (errors.length > 0 && plan.options.createErrorsTable) {
        await writeErrors(pgClient, errors, schema);
      }

      if (plan.options.dryRun) {
        await pgClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      }
    } finally {
      pgClient.release();
    }
  } finally {
    await mongoClient.close();
    await pgPool.end();
  }

  const duration = Date.now() - startTime;
  const allSuccess = results.every((r) => r.status === 'success');

  return {
    success: allSuccess && errors.length === 0,
    tables: results,
    totalErrors: errors.length,
    duration,
    dryRun: plan.options.dryRun,
  };
}

async function createErrorsTable(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}._migration_errors (
      id serial PRIMARY KEY,
      table_name text NOT NULL,
      source_id text,
      error_message text NOT NULL,
      source_data jsonb,
      created_at timestamptz DEFAULT now()
    )
  `);
}

async function createAllTables(
  client: PoolClient,
  mappings: TableMapping[],
  schema: string,
): Promise<void> {
  for (const mapping of mappings) {
    await createTable(client, schema, mapping.targetTable, mapping.fields);

    for (const nested of mapping.nestedMappings) {
      if (nested.strategy === 'table' && nested.fields) {
        await createTable(client, schema, nested.targetTable, nested.fields);
      }
    }

    for (const arr of mapping.arrayMappings) {
      if (arr.strategy === 'child_table' && arr.fields) {
        await createTable(client, schema, arr.targetTable, arr.fields);
      } else if (arr.strategy === 'array_column') {
        await createArrayTable(client, schema, arr);
      } else if (arr.strategy === 'junction') {
        await createJunctionTable(client, schema, arr);
      }
    }
  }
}

async function createTable(
  client: PoolClient,
  schema: string,
  tableName: string,
  fields: FieldMapping[],
): Promise<void> {
  const columns = fields.map((f) => {
    let def = `"${f.targetColumn}" ${f.targetType}`;
    if (f.isPrimaryKey) def += ' PRIMARY KEY';
    if (f.defaultValue) def += ` DEFAULT ${f.defaultValue}`;
    if (!f.nullable && !f.isPrimaryKey) def += ' NOT NULL';
    if (f.isUnique && !f.isPrimaryKey) def += ' UNIQUE';
    return def;
  });

  await client.query(
    `CREATE TABLE IF NOT EXISTS ${schema}."${tableName}" (${columns.join(', ')})`,
  );
}

async function createArrayTable(
  client: PoolClient,
  schema: string,
  arr: ArrayMapping,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}."${arr.targetTable}" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "${arr.parentForeignKey}" uuid NOT NULL,
      value ${arr.elementType || 'text'} NOT NULL
    )
  `);
}

async function createJunctionTable(
  client: PoolClient,
  schema: string,
  arr: ArrayMapping,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}."${arr.targetTable}" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "${arr.parentForeignKey}" uuid NOT NULL,
      value jsonb NOT NULL
    )
  `);
}

async function addForeignKeys(
  client: PoolClient,
  mappings: TableMapping[],
  schema: string,
): Promise<void> {
  for (const mapping of mappings) {
    for (const ref of mapping.detectedReferences) {
      const refMapping = mappings.find(
        (m) => m.sourceCollection === ref.targetCollection,
      );
      if (!refMapping) continue;

      const fkColumn = ref.foreignKeyColumn.endsWith('_id')
        ? ref.foreignKeyColumn
        : ref.foreignKeyColumn + '_id';

      const hasColumn = mapping.fields.some(
        (f) =>
          f.targetColumn === fkColumn ||
          f.targetColumn === ref.foreignKeyColumn,
      );
      if (!hasColumn) continue;

      const actualColumn = mapping.fields.find(
        (f) =>
          f.targetColumn === fkColumn ||
          f.targetColumn === ref.foreignKeyColumn,
      )?.targetColumn;

      if (!actualColumn) continue;

      try {
        const constraintName = `fk_${mapping.targetTable}_${actualColumn}`;
        await client.query(`
          ALTER TABLE ${schema}."${mapping.targetTable}"
          ADD CONSTRAINT "${constraintName}"
          FOREIGN KEY ("${actualColumn}")
          REFERENCES ${schema}."${refMapping.targetTable}"("id")
          ON DELETE SET NULL
        `);
      } catch {
        // FK constraint may fail if data doesn't align perfectly
      }
    }

    for (const nested of mapping.nestedMappings) {
      if (nested.strategy === 'table') {
        try {
          await client.query(`
            ALTER TABLE ${schema}."${nested.targetTable}"
            ADD CONSTRAINT "fk_${nested.targetTable}_${nested.parentForeignKey}"
            FOREIGN KEY ("${nested.parentForeignKey}")
            REFERENCES ${schema}."${mapping.targetTable}"("id")
            ON DELETE CASCADE
          `);
        } catch {
          // Constraint may already exist or source table missing; ignore.
        }
      }
    }

    for (const arr of mapping.arrayMappings) {
      try {
        await client.query(`
          ALTER TABLE ${schema}."${arr.targetTable}"
          ADD CONSTRAINT "fk_${arr.targetTable}_${arr.parentForeignKey}"
          FOREIGN KEY ("${arr.parentForeignKey}")
          REFERENCES ${schema}."${mapping.targetTable}"("id")
          ON DELETE CASCADE
        `);
      } catch {
        // Constraint may already exist; ignore.
      }
    }
  }
}

async function migrateCollection(
  db: Db,
  pgClient: PoolClient,
  mapping: TableMapping,
  plan: MigrationPlan,
  schema: string,
  errors: MigrationError[],
  onProgress?: (table: string, processed: number, total: number) => void,
): Promise<TableMigrationResult> {
  const collection = db.collection<MongoDocument>(mapping.sourceCollection);
  let query: Filter<MongoDocument> = {};

  if (plan.options.incremental && plan.options.since) {
    const sinceDate = new Date(plan.options.since);
    query = {
      $or: [
        { createdAt: { $gte: sinceDate } },
        { updatedAt: { $gte: sinceDate } },
        { created_at: { $gte: sinceDate } },
        { updated_at: { $gte: sinceDate } },
      ],
    };
  }

  const totalCount = await collection.countDocuments(query);
  let processed = 0;
  let failedCount = 0;
  const batchSize = plan.options.batchSize;
  const cursor = collection.find(query).batchSize(batchSize);

  let batch: MongoDocument[] = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;
    batch.push(doc as MongoDocument);

    if (batch.length >= batchSize) {
      const failed = await processBatch(
        pgClient,
        mapping,
        batch,
        schema,
        errors,
      );
      failedCount += failed;
      processed += batch.length;
      batch = [];
      onProgress?.(mapping.targetTable, processed, totalCount);
    }
  }

  if (batch.length > 0) {
    const failed = await processBatch(pgClient, mapping, batch, schema, errors);
    failedCount += failed;
    processed += batch.length;
    onProgress?.(mapping.targetTable, processed, totalCount);
  }

  await cursor.close();

  const targetCount = processed - failedCount;
  let status: 'success' | 'partial' | 'failed' = 'success';
  if (failedCount > 0 && targetCount > 0) status = 'partial';
  if (targetCount === 0 && totalCount > 0) status = 'failed';

  return {
    name: mapping.targetTable,
    sourceCount: totalCount,
    targetCount,
    failedCount,
    status,
  };
}

const MAX_PARAMS = 65000;

interface PendingRow {
  columns: string[];
  values: unknown[];
}

interface PendingTable {
  table: string;
  rows: PendingRow[];
}

async function flushPendingTable(
  pgClient: PoolClient,
  schema: string,
  pending: PendingTable,
): Promise<void> {
  if (pending.rows.length === 0) return;

  const columns = pending.rows[0].columns;
  const columnCount = columns.length;
  if (columnCount === 0) return;

  const batchSize = Math.max(1, Math.floor(MAX_PARAMS / columnCount));

  for (let start = 0; start < pending.rows.length; start += batchSize) {
    const chunk = pending.rows.slice(start, start + batchSize);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      const rowPlaceholders: string[] = [];
      for (const value of row.values) {
        rowPlaceholders.push(`$${paramIdx++}`);
        values.push(value);
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    await pgClient.query(
      `INSERT INTO ${schema}."${pending.table}" (${columns.join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
      values,
    );
  }

  pending.rows = [];
}

function buildDocumentRow(
  mapping: TableMapping,
  doc: MongoDocument,
): PendingRow | null {
  const columns: string[] = [];
  const values: unknown[] = [];

  for (const field of mapping.fields) {
    const value = getNestedValue(doc, field.sourceField);

    let pgValue: unknown;
    if (field.transform === 'uuid_from_objectid' && value) {
      const v = value as { toString: () => string };
      pgValue = objectIdToUuid(v.toString());
    } else if (field.transform === 'jsonb') {
      pgValue = value != null ? JSON.stringify(value) : null;
    } else if (field.transform === 'cast' && value != null) {
      const result = coerceValue(value, typeof value, field.targetType);
      pgValue = result.success ? result.value : null;
    } else if (value instanceof Date) {
      pgValue = value;
    } else if (
      typeof value === 'object' &&
      value !== null &&
      field.targetType === 'jsonb'
    ) {
      pgValue = JSON.stringify(value);
    } else if (value !== undefined && value !== null) {
      const maybeToString = value as { toString?: () => string };
      pgValue = maybeToString.toString
        ? maybeToString.toString()
        : (value as unknown);
    } else {
      pgValue = null;
    }

    columns.push(`"${field.targetColumn}"`);
    values.push(pgValue);
  }

  return columns.length > 0 ? { columns, values } : null;
}

function buildNestedRow(
  nested: NestedMapping,
  value: Record<string, unknown>,
  parentId: string,
): PendingRow | null {
  if (!nested.fields) return null;

  const columns: string[] = [];
  const values: unknown[] = [];

  for (const field of nested.fields) {
    if (field.sourceField === 'id') {
      columns.push('"id"');
      values.push(randomUUID());
    } else if (
      field.sourceField.includes('_id') &&
      field.targetType === 'uuid'
    ) {
      columns.push(`"${field.targetColumn}"`);
      values.push(parentId);
    } else {
      const fieldName = field.sourceField.split('.').pop() || field.sourceField;
      columns.push(`"${field.targetColumn}"`);
      values.push(value[fieldName] ?? null);
    }
  }

  return { columns, values };
}

function buildArrayRow(
  arr: ArrayMapping,
  element: unknown,
  parentId: string,
): PendingRow {
  if (arr.strategy === 'child_table' && arr.fields) {
    const columns: string[] = [];
    const values: unknown[] = [];

    for (const field of arr.fields) {
      if (field.sourceField === 'id') {
        columns.push('"id"');
        values.push(randomUUID());
      } else if (
        field.sourceField.includes('_id') &&
        field.targetType === 'uuid'
      ) {
        columns.push(`"${field.targetColumn}"`);
        values.push(parentId);
      } else {
        const fieldName =
          field.sourceField.split('.').pop() || field.sourceField;
        const val =
          typeof element === 'object' && element
            ? ((element as Record<string, unknown>)[fieldName] ?? null)
            : null;
        columns.push(`"${field.targetColumn}"`);
        values.push(val);
      }
    }

    return { columns, values };
  }

  const val: unknown =
    typeof element === 'object' && element !== null
      ? JSON.stringify(element)
      : element;

  return {
    columns: ['"id"', `"${arr.parentForeignKey}"`, '"value"'],
    values: [randomUUID(), parentId, val],
  };
}

async function processBatch(
  pgClient: PoolClient,
  mapping: TableMapping,
  docs: MongoDocument[],
  schema: string,
  errors: MigrationError[],
): Promise<number> {
  const topLevel: PendingTable = { table: mapping.targetTable, rows: [] };
  const nestedTables = new Map<string, PendingTable>();
  const arrayTables = new Map<string, PendingTable>();

  for (const doc of docs) {
    const parentId = doc._id
      ? objectIdToUuid(doc._id.toString())
      : randomUUID();

    const docRow = buildDocumentRow(mapping, doc);
    if (docRow) {
      topLevel.rows.push(docRow);
    }

    for (const nested of mapping.nestedMappings) {
      if (nested.strategy === 'table' && nested.fields) {
        const nestedValue = getNestedValue(doc, nested.sourceField);
        if (
          nestedValue &&
          typeof nestedValue === 'object' &&
          !Array.isArray(nestedValue)
        ) {
          const row = buildNestedRow(
            nested,
            nestedValue as Record<string, unknown>,
            parentId,
          );
          if (row) {
            const bucket = nestedTables.get(nested.targetTable) ?? {
              table: nested.targetTable,
              rows: [],
            };
            bucket.rows.push(row);
            nestedTables.set(nested.targetTable, bucket);
          }
        }
      }
    }

    for (const arr of mapping.arrayMappings) {
      const arrayValue = getNestedValue(doc, arr.sourceField);
      if (Array.isArray(arrayValue)) {
        for (const element of arrayValue as unknown[]) {
          const row = buildArrayRow(arr, element, parentId);
          const bucket = arrayTables.get(arr.targetTable) ?? {
            table: arr.targetTable,
            rows: [],
          };
          bucket.rows.push(row);
          arrayTables.set(arr.targetTable, bucket);
        }
      }
    }
  }

  try {
    await flushPendingTable(pgClient, schema, topLevel);
    for (const pending of nestedTables.values()) {
      await flushPendingTable(pgClient, schema, pending);
    }
    for (const pending of arrayTables.values()) {
      await flushPendingTable(pgClient, schema, pending);
    }
    return 0;
  } catch {
    return processBatchPerDocument(pgClient, mapping, docs, schema, errors);
  }
}

async function processBatchPerDocument(
  pgClient: PoolClient,
  mapping: TableMapping,
  docs: MongoDocument[],
  schema: string,
  errors: MigrationError[],
): Promise<number> {
  let failed = 0;

  for (const doc of docs) {
    try {
      await insertDocument(pgClient, mapping, doc, schema);
    } catch (err) {
      failed++;
      const sourceId =
        doc._id && typeof doc._id.toString === 'function'
          ? doc._id.toString()
          : 'unknown';
      errors.push({
        table: mapping.targetTable,
        sourceId,
        error: err instanceof Error ? err.message : String(err),
        data: safeStringify(doc),
      });
    }
  }

  return failed;
}

async function insertDocument(
  pgClient: PoolClient,
  mapping: TableMapping,
  doc: MongoDocument,
  schema: string,
): Promise<void> {
  const parentId = doc._id ? objectIdToUuid(doc._id.toString()) : randomUUID();

  const docRow = buildDocumentRow(mapping, doc);
  if (docRow) {
    await pgClient.query(
      `INSERT INTO ${schema}."${mapping.targetTable}" (${docRow.columns.join(', ')}) VALUES (${docRow.columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`,
      docRow.values,
    );
  }

  for (const nested of mapping.nestedMappings) {
    if (nested.strategy === 'table' && nested.fields) {
      const nestedValue = getNestedValue(doc, nested.sourceField);
      if (
        nestedValue &&
        typeof nestedValue === 'object' &&
        !Array.isArray(nestedValue)
      ) {
        await insertNestedObject(
          pgClient,
          schema,
          nested,
          nestedValue as Record<string, unknown>,
          parentId,
        );
      }
    }
  }

  for (const arr of mapping.arrayMappings) {
    const arrayValue = getNestedValue(doc, arr.sourceField);
    if (Array.isArray(arrayValue)) {
      await insertArrayElements(
        pgClient,
        schema,
        arr,
        arrayValue as unknown[],
        parentId,
      );
    }
  }
}

async function insertNestedObject(
  pgClient: PoolClient,
  schema: string,
  nested: NestedMapping,
  value: Record<string, unknown>,
  parentId: string,
): Promise<void> {
  if (!nested.fields) return;

  const columns: string[] = [];
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const field of nested.fields) {
    if (field.sourceField === 'id') {
      columns.push('"id"');
      values.push(randomUUID());
      placeholders.push(`$${paramIdx++}`);
    } else if (
      field.sourceField.includes('_id') &&
      field.targetType === 'uuid'
    ) {
      columns.push(`"${field.targetColumn}"`);
      values.push(parentId);
      placeholders.push(`$${paramIdx++}`);
    } else {
      const fieldName = field.sourceField.split('.').pop() || field.sourceField;
      const val = value[fieldName] ?? null;
      columns.push(`"${field.targetColumn}"`);
      values.push(val);
      placeholders.push(`$${paramIdx++}`);
    }
  }

  await pgClient.query(
    `INSERT INTO ${schema}."${nested.targetTable}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING`,
    values,
  );
}

async function insertArrayElements(
  pgClient: PoolClient,
  schema: string,
  arr: ArrayMapping,
  values: unknown[],
  parentId: string,
): Promise<void> {
  for (const element of values) {
    if (arr.strategy === 'child_table' && arr.fields) {
      const columns: string[] = [];
      const vals: unknown[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;

      for (const field of arr.fields) {
        if (field.sourceField === 'id') {
          columns.push('"id"');
          vals.push(randomUUID());
          placeholders.push(`$${paramIdx++}`);
        } else if (
          field.sourceField.includes('_id') &&
          field.targetType === 'uuid'
        ) {
          columns.push(`"${field.targetColumn}"`);
          vals.push(parentId);
          placeholders.push(`$${paramIdx++}`);
        } else {
          const fieldName =
            field.sourceField.split('.').pop() || field.sourceField;
          const val =
            typeof element === 'object' && element
              ? ((element as Record<string, unknown>)[fieldName] ?? null)
              : null;
          columns.push(`"${field.targetColumn}"`);
          vals.push(val);
          placeholders.push(`$${paramIdx++}`);
        }
      }

      await pgClient.query(
        `INSERT INTO ${schema}."${arr.targetTable}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING`,
        vals,
      );
    } else {
      const val: unknown =
        typeof element === 'object' && element !== null
          ? JSON.stringify(element)
          : element;

      await pgClient.query(
        `INSERT INTO ${schema}."${arr.targetTable}" ("id", "${arr.parentForeignKey}", "value") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [randomUUID(), parentId, val],
      );
    }
  }
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (!path || !obj) return obj;
  const parts = path.replace(/\[\]/g, '').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function writeErrors(
  client: PoolClient,
  errors: MigrationError[],
  schema: string,
): Promise<void> {
  for (const err of errors) {
    try {
      await client.query(
        `INSERT INTO ${schema}._migration_errors (table_name, source_id, error_message, source_data) VALUES ($1, $2, $3, $4)`,
        [err.table, err.sourceId, err.error, err.data],
      );
    } catch {
      // Error table write is best-effort; ignore.
    }
  }
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_, value: unknown) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (value && typeof value === 'object' && '_bsontype' in value) {
        const v = value as { toString: () => string };
        return v.toString();
      }
      return value;
    });
  } catch {
    return '{}';
  }
}
