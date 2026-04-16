import {
  MongoAnalysisResult,
  MongoCollectionAnalysis,
  MongoFieldInfo,
  TableMapping,
  FieldMapping,
  NestedMapping,
  ArrayMapping,
  MigrationConflict,
  MigrationPlan,
  MigrationOptions,
  DEFAULT_MIGRATION_OPTIONS,
} from '../types';
import {
  mongoTypeToPgType,
  resolveMajorityType,
  toSnakeCase,
  singularize,
} from '../type.mapper';
import { detectReferences } from '../reference.detector';

export function generateMongoToPostgresPlan(
  analysis: MongoAnalysisResult,
  sourceUrl: string,
  targetUrl: string,
  options: Partial<MigrationOptions> = {},
): MigrationPlan {
  const mergedOptions = { ...DEFAULT_MIGRATION_OPTIONS, ...options };
  const conflicts: MigrationConflict[] = [];
  const referenceMap = detectReferences(analysis.collections);
  const tableMappings: TableMapping[] = [];

  for (const collection of analysis.collections) {
    const refs = referenceMap.get(collection.name) || [];
    const mapping = mapCollection(
      collection,
      refs,
      conflicts,
      mergedOptions.maxNestingDepth,
    );
    tableMappings.push(mapping);
  }

  return {
    version: '1.0.0',
    direction: 'mongo_to_postgres',
    source: { type: 'mongodb', url: sourceUrl, database: analysis.database },
    target: {
      type: 'postgresql',
      url: targetUrl,
      database: extractDbName(targetUrl),
    },
    tableMappings,
    conflicts,
    options: mergedOptions,
  };
}

function extractDbName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, '') || 'postgres';
  } catch {
    return 'postgres';
  }
}

function mapCollection(
  collection: MongoCollectionAnalysis,
  detectedRefs: {
    sourceField: string;
    targetCollection: string;
    foreignKeyColumn: string;
    foreignKeyTable: string;
  }[],
  conflicts: MigrationConflict[],
  maxDepth: number,
): TableMapping {
  const tableName = toSnakeCase(collection.name);
  const fields: FieldMapping[] = [];
  const nestedMappings: NestedMapping[] = [];
  const arrayMappings: ArrayMapping[] = [];

  for (const field of collection.fields) {
    processField(
      field,
      tableName,
      collection.name,
      fields,
      nestedMappings,
      arrayMappings,
      conflicts,
      maxDepth,
      collection.documentCount,
    );
  }

  const hasIdField = fields.some((f) => f.sourceField === '_id');
  if (!hasIdField) {
    fields.unshift({
      sourceField: '_id',
      targetColumn: 'id',
      targetType: 'uuid',
      transform: 'uuid_from_objectid',
      nullable: false,
      isUnique: true,
      isPrimaryKey: true,
    });
  }

  const usedColumns = new Set<string>();
  for (const field of fields) {
    if (usedColumns.has(field.targetColumn)) {
      const original = field.targetColumn;
      field.targetColumn = field.isPrimaryKey
        ? original
        : `${original}_original`;
    }
    usedColumns.add(field.targetColumn);
  }

  return {
    sourceCollection: collection.name,
    targetTable: tableName,
    fields,
    nestedMappings,
    arrayMappings,
    detectedReferences: detectedRefs,
  };
}

function processField(
  field: MongoFieldInfo,
  parentTable: string,
  collectionName: string,
  fields: FieldMapping[],
  nestedMappings: NestedMapping[],
  arrayMappings: ArrayMapping[],
  conflicts: MigrationConflict[],
  maxDepth: number,
  docCount: number,
): void {
  if (field.name === '_id') {
    fields.push({
      sourceField: '_id',
      targetColumn: 'id',
      targetType: 'uuid',
      transform: 'uuid_from_objectid',
      nullable: false,
      isUnique: true,
      isPrimaryKey: true,
    });
    return;
  }

  const nonNullTypes = Object.entries(field.types).filter(
    ([t]) => t !== 'null' && t !== 'undefined',
  );

  if (nonNullTypes.length > 1) {
    const sorted = nonNullTypes.sort((a, b) => b[1] - a[1]);
    const majorType = sorted[0][0];
    const total = sorted.reduce((sum, [, c]) => sum + c, 0);

    conflicts.push({
      type: 'type_mismatch',
      location: `${collectionName}.${field.path}`,
      field: field.name,
      details: sorted.map(([t, c]) => `${t} in ${c} docs`).join(', '),
      suggestion: `cast to ${mongoTypeToPgType(majorType)}, log failures`,
    });
  }

  if (field.frequency < 100) {
    conflicts.push({
      type: 'missing_field',
      location: `${collectionName}.${field.path}`,
      field: field.name,
      details: `missing in ${(100 - field.frequency).toFixed(1)}% of documents`,
      suggestion: 'nullable column',
    });
  }

  if (field.isNestedObject && !field.isArray) {
    handleNestedObject(
      field,
      parentTable,
      collectionName,
      fields,
      nestedMappings,
      conflicts,
      maxDepth,
      docCount,
    );
    return;
  }

  if (field.isArray) {
    handleArray(
      field,
      parentTable,
      collectionName,
      arrayMappings,
      conflicts,
      maxDepth,
      docCount,
    );
    return;
  }

  const majorType = resolveMajorityType(field.types);
  const pgType = field.isObjectId ? 'uuid' : mongoTypeToPgType(majorType);
  const hasNullValues =
    (field.types['null'] || 0) + (field.types['undefined'] || 0) > 0;
  const isNullable = field.frequency < 100 || hasNullValues;

  const columnName = toSnakeCase(field.name);
  const isUniqueFromIndex = false;

  fields.push({
    sourceField: field.path,
    targetColumn: columnName,
    targetType: pgType,
    transform: field.isObjectId ? 'uuid_from_objectid' : undefined,
    nullable: isNullable,
    isUnique: isUniqueFromIndex,
    isPrimaryKey: false,
  });
}

function handleNestedObject(
  field: MongoFieldInfo,
  parentTable: string,
  collectionName: string,
  fields: FieldMapping[],
  nestedMappings: NestedMapping[],
  conflicts: MigrationConflict[],
  maxDepth: number,
  docCount: number,
): void {
  const nestedFields = field.nestedFields || [];
  const isConsistent =
    nestedFields.length > 0 &&
    nestedFields.length <= 20 &&
    nestedFields.every((f) => f.frequency > 50);

  if (isConsistent && field.depth < maxDepth) {
    const childTable = `${singularize(parentTable)}_${toSnakeCase(field.name)}`;
    const childFields: FieldMapping[] = [
      {
        sourceField: 'id',
        targetColumn: 'id',
        targetType: 'uuid',
        nullable: false,
        isUnique: true,
        isPrimaryKey: true,
        defaultValue: 'gen_random_uuid()',
      },
      {
        sourceField: `${parentTable}_id`,
        targetColumn: `${singularize(parentTable)}_id`,
        targetType: 'uuid',
        nullable: false,
        isUnique: false,
        isPrimaryKey: false,
      },
    ];

    for (const nested of nestedFields) {
      const majorType = resolveMajorityType(nested.types);
      childFields.push({
        sourceField: nested.path,
        targetColumn: toSnakeCase(nested.name),
        targetType: mongoTypeToPgType(majorType),
        nullable: nested.frequency < 100,
        isUnique: false,
        isPrimaryKey: false,
      });
    }

    nestedMappings.push({
      sourceField: field.path,
      targetTable: childTable,
      strategy: 'table',
      parentForeignKey: `${singularize(parentTable)}_id`,
      fields: childFields,
      relationType: '1:1',
    });
  } else {
    fields.push({
      sourceField: field.path,
      targetColumn: toSnakeCase(field.name),
      targetType: 'jsonb',
      transform: 'jsonb',
      nullable: field.frequency < 100,
      isUnique: false,
      isPrimaryKey: false,
    });
  }
}

function handleArray(
  field: MongoFieldInfo,
  parentTable: string,
  collectionName: string,
  arrayMappings: ArrayMapping[],
  conflicts: MigrationConflict[],
  maxDepth: number,
  docCount: number,
): void {
  const elementTypes = field.arrayElementType?.split(' | ') || [];
  const hasObjects = elementTypes.includes('object');
  const hasPrimitives = elementTypes.some(
    (t) => t !== 'object' && t !== 'null' && t !== 'undefined',
  );

  if (hasObjects && field.nestedFields && field.nestedFields.length > 0) {
    const childTable = `${singularize(parentTable)}_${toSnakeCase(field.name)}`;
    const childFields: FieldMapping[] = [
      {
        sourceField: 'id',
        targetColumn: 'id',
        targetType: 'uuid',
        nullable: false,
        isUnique: true,
        isPrimaryKey: true,
        defaultValue: 'gen_random_uuid()',
      },
      {
        sourceField: `${parentTable}_id`,
        targetColumn: `${singularize(parentTable)}_id`,
        targetType: 'uuid',
        nullable: false,
        isUnique: false,
        isPrimaryKey: false,
      },
    ];

    for (const nested of field.nestedFields) {
      const majorType = resolveMajorityType(nested.types);
      childFields.push({
        sourceField: nested.path,
        targetColumn: toSnakeCase(nested.name),
        targetType: mongoTypeToPgType(majorType),
        nullable: nested.frequency < 100,
        isUnique: false,
        isPrimaryKey: false,
      });
    }

    arrayMappings.push({
      sourceField: field.path,
      targetTable: childTable,
      strategy: 'child_table',
      parentForeignKey: `${singularize(parentTable)}_id`,
      fields: childFields,
    });
  } else if (hasPrimitives && !hasObjects) {
    const majorType =
      elementTypes.find((t) => t !== 'null' && t !== 'undefined') || 'string';
    const pgElementType = mongoTypeToPgType(majorType);

    arrayMappings.push({
      sourceField: field.path,
      targetTable: `${singularize(parentTable)}_${toSnakeCase(field.name)}`,
      strategy: 'array_column',
      parentForeignKey: `${singularize(parentTable)}_id`,
      elementType: pgElementType,
    });
  } else {
    arrayMappings.push({
      sourceField: field.path,
      targetTable: `${singularize(parentTable)}_${toSnakeCase(field.name)}`,
      strategy: 'junction',
      parentForeignKey: `${singularize(parentTable)}_id`,
      elementType: 'jsonb',
    });
  }
}
