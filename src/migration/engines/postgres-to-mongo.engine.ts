import { MongoClient, Db, ObjectId } from 'mongodb';
import { Pool } from 'pg';
import {
  MigrationPlan,
  DocumentMapping,
  MigrationResult,
  TableMigrationResult,
} from '../types';

interface MigrationError {
  collection: string;
  sourceId: string;
  error: string;
  data?: any;
}

export async function executePostgresToMongo(
  plan: MigrationPlan,
  onProgress?: (collection: string, processed: number, total: number) => void,
): Promise<MigrationResult> {
  const startTime = Date.now();
  const errors: MigrationError[] = [];
  const results: TableMigrationResult[] = [];

  const pgPool = new Pool({ connectionString: plan.source.url });
  const mongoClient = new MongoClient(plan.target.url);

  try {
    await mongoClient.connect();
    const db = mongoClient.db(plan.target.database);
    const errorsCollection = plan.options.createErrorsTable
      ? db.collection('_migration_errors')
      : null;

    for (const mapping of plan.documentMappings || []) {
      const result = await migrateTable(
        pgPool,
        db,
        mapping,
        plan,
        errors,
        onProgress,
      );
      results.push(result);
    }

    if (errorsCollection && errors.length > 0) {
      const errorDocs = errors.map((e) => ({
        collection: e.collection,
        sourceId: e.sourceId,
        error: e.error,
        sourceData: e.data,
        createdAt: new Date(),
      }));
      await errorsCollection.insertMany(errorDocs);
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

async function migrateTable(
  pgPool: Pool,
  db: Db,
  mapping: DocumentMapping,
  plan: MigrationPlan,
  errors: MigrationError[],
  onProgress?: (collection: string, processed: number, total: number) => void,
): Promise<TableMigrationResult> {
  const batchSize = plan.options.batchSize;
  const collection = db.collection(mapping.targetCollection);

  if (!plan.options.incremental) {
    await collection.deleteMany({});
  }

  let whereClause = '';
  if (plan.options.incremental && plan.options.since) {
    whereClause = buildIncrementalWhere(plan.options.since);
  }

  const countResult = await pgPool.query(
    `SELECT count(*)::integer AS count FROM "${mapping.primaryTable}" ${whereClause}`,
  );
  const totalCount = parseInt(countResult.rows[0]?.count || '0');

  let processed = 0;
  let failedCount = 0;
  let offset = 0;

  while (offset < totalCount) {
    const rows = await pgPool.query(
      `SELECT * FROM "${mapping.primaryTable}" ${whereClause} ORDER BY 1 LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );

    const documents: any[] = [];

    for (const row of rows.rows) {
      try {
        const doc = await buildDocument(pgPool, mapping, row);
        documents.push(doc);
      } catch (err) {
        failedCount++;
        const pkColumn = Object.keys(row)[0];
        errors.push({
          collection: mapping.targetCollection,
          sourceId: String(row[pkColumn]),
          error: err instanceof Error ? err.message : String(err),
          data: JSON.stringify(row),
        });
      }
    }

    if (documents.length > 0) {
      try {
        if (plan.options.incremental) {
          for (const doc of documents) {
            await collection.replaceOne(
              { _id: doc._id },
              doc,
              { upsert: true },
            );
          }
        } else {
          await collection.insertMany(documents, { ordered: false });
        }
      } catch (err) {
        failedCount += documents.length;
        errors.push({
          collection: mapping.targetCollection,
          sourceId: 'batch',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    processed += rows.rows.length;
    offset += batchSize;
    onProgress?.(mapping.targetCollection, processed, totalCount);
  }

  const targetCount = processed - failedCount;

  return {
    name: mapping.targetCollection,
    sourceCount: totalCount,
    targetCount,
    failedCount,
    status:
      failedCount === 0
        ? 'success'
        : targetCount > 0
          ? 'partial'
          : 'failed',
  };
}

async function buildDocument(
  pgPool: Pool,
  mapping: DocumentMapping,
  row: any,
): Promise<any> {
  const doc: any = {};

  for (const [pgCol, mongoField] of Object.entries(mapping.fieldMappings)) {
    if (pgCol.startsWith('_')) continue;
    const value = row[pgCol];
    if (value === undefined) continue;

    if (mongoField === '_id') {
      doc._id = convertToMongoId(value);
    } else {
      doc[mongoField] = convertPgValueToMongo(value);
    }
  }

  for (const embed of mapping.embeddings) {
    const childRows = await pgPool.query(
      `SELECT * FROM "${embed.sourceTable}" WHERE "${embed.foreignKey}" = $1`,
      [getPrimaryKeyValue(row)],
    );

    if (embed.isArray) {
      doc[embed.embedAs] = childRows.rows.map((r) =>
        convertRowToEmbeddedDoc(r, embed.foreignKey),
      );
    } else if (childRows.rows.length > 0) {
      doc[embed.embedAs] = convertRowToEmbeddedDoc(
        childRows.rows[0],
        embed.foreignKey,
      );
    }
  }

  for (const [pgCol, mongoField] of Object.entries(mapping.fieldMappings)) {
    if (!pgCol.startsWith('_')) continue;
    const otherTable = pgCol.slice(1);

    const relatedRows = await pgPool.query(
      `SELECT * FROM "${otherTable}" ORDER BY 1`,
    );

    doc[mongoField] = relatedRows.rows.map((r) => {
      const pk = Object.keys(r)[0];
      return convertPgValueToMongo(r[Object.keys(r).find((k) => k !== pk) || pk]);
    });
  }

  return doc;
}

function convertToMongoId(value: any): any {
  if (typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)) {
    return new ObjectId(value);
  }
  return value;
}

function convertPgValueToMongo(value: any): any {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return value.map(convertPgValueToMongo);
  return value;
}

function convertRowToEmbeddedDoc(row: any, excludeFk: string): any {
  const doc: any = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === excludeFk) continue;
    if (key === 'id') continue;
    const camelKey = key.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    doc[camelKey] = convertPgValueToMongo(value);
  }
  return doc;
}

function getPrimaryKeyValue(row: any): any {
  return row.id || row[Object.keys(row)[0]];
}

function buildIncrementalWhere(since: string): string {
  const sinceDate = new Date(since).toISOString();
  return `WHERE COALESCE(created_at, updated_at, '1970-01-01'::timestamptz) >= '${sinceDate}'`;
}
