import { MongoClient, Db, ObjectId } from 'mongodb';
import {
  MongoAnalysisResult,
  MongoCollectionAnalysis,
  MongoFieldInfo,
  ParsedDatabaseUrl,
} from '../types';
import { detectMongoFieldType } from '../type.mapper';

const SAMPLE_SIZE = 5000;
const MAX_SAMPLE_VALUES = 5;

export function parseMongoUrl(urlString: string): ParsedDatabaseUrl {
  const url = new URL(urlString);
  if (url.protocol !== 'mongodb:' && url.protocol !== 'mongodb+srv:') {
    throw new Error(`Invalid protocol "${url.protocol}". Expected "mongodb://" or "mongodb+srv://"`);
  }
  const database = url.pathname.replace(/^\//, '') || 'test';
  return {
    type: 'mongodb',
    url: urlString,
    database,
    host: url.hostname || 'localhost',
    port: parseInt(url.port || '27017'),
  };
}

export async function analyzeMongoDB(
  connectionUrl: string,
  sampleSize: number = SAMPLE_SIZE,
): Promise<MongoAnalysisResult> {
  const parsed = parseMongoUrl(connectionUrl);
  const client = new MongoClient(connectionUrl);

  try {
    await client.connect();
    const db = client.db(parsed.database);
    const collectionNames = await getCollectionNames(db);
    const collections: MongoCollectionAnalysis[] = [];
    let totalDocuments = 0;

    for (const name of collectionNames) {
      const analysis = await analyzeCollection(db, name, sampleSize);
      collections.push(analysis);
      totalDocuments += analysis.documentCount;
    }

    return {
      database: parsed.database,
      type: 'mongodb',
      collections,
      totalDocuments,
    };
  } finally {
    await client.close();
  }
}

async function getCollectionNames(db: Db): Promise<string[]> {
  const collections = await db.listCollections().toArray();
  return collections
    .filter((c) => c.type === 'collection')
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'));
}

async function analyzeCollection(
  db: Db,
  collectionName: string,
  sampleSize: number,
): Promise<MongoCollectionAnalysis> {
  const collection = db.collection(collectionName);
  const documentCount = await collection.countDocuments();

  let documents: any[];
  if (documentCount <= sampleSize) {
    documents = await collection.find({}).toArray();
  } else {
    documents = await collection.aggregate([{ $sample: { size: sampleSize } }]).toArray();
  }

  const fieldMap = new Map<string, FieldAccumulator>();
  const sampledCount = documents.length;

  for (const doc of documents) {
    analyzeDocument(doc, '', fieldMap, 0);
  }

  const fields = buildFieldInfos(fieldMap, sampledCount, documentCount);

  const indexes = await collection.indexes().catch(() => []);
  const indexInfo = indexes.map((idx: any) => ({
    name: idx.name,
    key: idx.key,
    unique: idx.unique || false,
  }));

  return {
    name: collectionName,
    documentCount,
    fields,
    indexes: indexInfo,
  };
}

interface FieldAccumulator {
  name: string;
  path: string;
  typeCounts: Record<string, number>;
  count: number;
  isArray: boolean;
  isObjectId: boolean;
  isNestedObject: boolean;
  sampleValues: any[];
  depth: number;
  children: Map<string, FieldAccumulator>;
  arrayElementTypes: Set<string>;
}

function getOrCreateAccumulator(
  map: Map<string, FieldAccumulator>,
  path: string,
  name: string,
  depth: number,
): FieldAccumulator {
  if (!map.has(path)) {
    map.set(path, {
      name,
      path,
      typeCounts: {},
      count: 0,
      isArray: false,
      isObjectId: false,
      isNestedObject: false,
      sampleValues: [],
      depth,
      children: new Map(),
      arrayElementTypes: new Set(),
    });
  }
  return map.get(path)!;
}

function analyzeDocument(
  doc: any,
  prefix: string,
  fieldMap: Map<string, FieldAccumulator>,
  depth: number,
): void {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;

  for (const [key, value] of Object.entries(doc)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const acc = getOrCreateAccumulator(fieldMap, path, key, depth);
    acc.count++;

    const fieldType = detectMongoFieldType(value);
    acc.typeCounts[fieldType] = (acc.typeCounts[fieldType] || 0) + 1;

    if (acc.sampleValues.length < MAX_SAMPLE_VALUES) {
      acc.sampleValues.push(summarizeValue(value));
    }

    if (fieldType === 'objectId') {
      acc.isObjectId = true;
    }

    if (fieldType === 'array' && Array.isArray(value)) {
      acc.isArray = true;
      for (const element of value.slice(0, 100)) {
        const elType = detectMongoFieldType(element);
        acc.arrayElementTypes.add(elType);
        if (elType === 'object' && element && typeof element === 'object') {
          analyzeDocument(element, path + '[]', fieldMap, depth + 1);
        }
      }
    }

    if (fieldType === 'object' && value && !isSpecialBsonType(value)) {
      acc.isNestedObject = true;
      analyzeDocument(value, path, fieldMap, depth + 1);
    }
  }
}

function isSpecialBsonType(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  return !!(value._bsontype || value instanceof ObjectId || value instanceof Date);
}

function summarizeValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 50 ? value.slice(0, 50) + '...' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId || value?._bsontype === 'ObjectId') return value.toString();
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (typeof value === 'object') return `{Object(${Object.keys(value).length} keys)}`;
  return String(value);
}

function buildFieldInfos(
  fieldMap: Map<string, FieldAccumulator>,
  sampledCount: number,
  totalCount: number,
): MongoFieldInfo[] {
  const topLevelFields: MongoFieldInfo[] = [];

  const topLevelEntries = Array.from(fieldMap.entries()).filter(
    ([path]) => !path.includes('.'),
  );

  for (const [, acc] of topLevelEntries) {
    const field = accumulatorToFieldInfo(acc, fieldMap, sampledCount, totalCount);
    topLevelFields.push(field);
  }

  topLevelFields.sort((a, b) => b.frequency - a.frequency);
  return topLevelFields;
}

function accumulatorToFieldInfo(
  acc: FieldAccumulator,
  fieldMap: Map<string, FieldAccumulator>,
  sampledCount: number,
  totalCount: number,
): MongoFieldInfo {
  const frequency =
    sampledCount > 0
      ? Math.round((acc.count / sampledCount) * 100 * 100) / 100
      : 0;

  const nestedFields: MongoFieldInfo[] = [];
  const childPrefix = acc.path + '.';
  const arrayChildPrefix = acc.path + '[].';

  for (const [path, childAcc] of fieldMap.entries()) {
    if (path.startsWith(childPrefix) || path.startsWith(arrayChildPrefix)) {
      const remaining = path.startsWith(childPrefix)
        ? path.slice(childPrefix.length)
        : path.slice(arrayChildPrefix.length);
      if (!remaining.includes('.') && !remaining.includes('[]')) {
        nestedFields.push(
          accumulatorToFieldInfo(childAcc, fieldMap, sampledCount, totalCount),
        );
      }
    }
  }

  nestedFields.sort((a, b) => b.frequency - a.frequency);

  const possibleReference = acc.isObjectId && acc.name !== '_id'
    ? guessReferenceFromName(acc.name)
    : undefined;

  return {
    name: acc.name,
    path: acc.path,
    types: acc.typeCounts,
    totalCount: Math.round((acc.count / sampledCount) * totalCount),
    frequency,
    isArray: acc.isArray,
    isObjectId: acc.isObjectId,
    isNestedObject: acc.isNestedObject,
    nestedFields: nestedFields.length > 0 ? nestedFields : undefined,
    arrayElementType:
      acc.arrayElementTypes.size > 0
        ? Array.from(acc.arrayElementTypes).join(' | ')
        : undefined,
    possibleReference,
    sampleValues: acc.sampleValues,
    depth: acc.depth,
  };
}

function guessReferenceFromName(fieldName: string): string | undefined {
  const cleaned = fieldName.replace(/(_id|Id)$/, '');
  return cleaned || undefined;
}
