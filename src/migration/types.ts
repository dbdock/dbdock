export type DatabaseType = 'mongodb' | 'postgresql';

export interface ParsedDatabaseUrl {
  type: DatabaseType;
  url: string;
  database: string;
  host: string;
  port: number;
}

export interface MongoFieldInfo {
  name: string;
  path: string;
  types: Record<string, number>;
  totalCount: number;
  frequency: number;
  isArray: boolean;
  isObjectId: boolean;
  isNestedObject: boolean;
  nestedFields?: MongoFieldInfo[];
  arrayElementType?: string;
  possibleReference?: string;
  sampleValues: unknown[];
  depth: number;
}

export interface MongoCollectionAnalysis {
  name: string;
  documentCount: number;
  fields: MongoFieldInfo[];
  indexes: Array<{
    name: string;
    key: Record<string, number>;
    unique?: boolean;
  }>;
}

export interface MongoAnalysisResult {
  database: string;
  type: 'mongodb';
  collections: MongoCollectionAnalysis[];
  totalDocuments: number;
}

export interface PgColumnInfo {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  characterMaxLength: number | null;
  numericPrecision: number | null;
}

export interface PgForeignKey {
  constraintName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface PgIndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

export interface PgTableAnalysis {
  name: string;
  schema: string;
  columns: PgColumnInfo[];
  foreignKeys: PgForeignKey[];
  indexes: PgIndexInfo[];
  rowCount: number;
}

export interface PgAnalysisResult {
  database: string;
  type: 'postgresql';
  tables: PgTableAnalysis[];
  totalRows: number;
}

export type AnalysisResult = MongoAnalysisResult | PgAnalysisResult;

export interface FieldMapping {
  sourceField: string;
  targetColumn: string;
  targetType: string;
  transform?: 'cast' | 'jsonb' | 'array' | 'uuid_from_objectid';
  nullable: boolean;
  isUnique: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string;
}

export interface NestedMapping {
  sourceField: string;
  targetTable: string;
  strategy: 'table' | 'jsonb';
  parentForeignKey: string;
  fields?: FieldMapping[];
  relationType: '1:1' | '1:many';
}

export interface ArrayMapping {
  sourceField: string;
  targetTable: string;
  strategy: 'junction' | 'array_column' | 'child_table';
  parentForeignKey: string;
  elementType?: string;
  fields?: FieldMapping[];
}

export interface DetectedReference {
  sourceField: string;
  targetCollection: string;
  foreignKeyColumn: string;
  foreignKeyTable: string;
}

export interface TableMapping {
  sourceCollection: string;
  targetTable: string;
  fields: FieldMapping[];
  nestedMappings: NestedMapping[];
  arrayMappings: ArrayMapping[];
  detectedReferences: DetectedReference[];
}

export interface EmbedConfig {
  sourceTable: string;
  foreignKey: string;
  embedAs: string;
  isArray: boolean;
}

export interface RefConfig {
  sourceTable: string;
  foreignKey: string;
  refField: string;
}

export interface DocumentMapping {
  primaryTable: string;
  targetCollection: string;
  fieldMappings: Record<string, string>;
  embeddings: EmbedConfig[];
  references: RefConfig[];
}

export interface MigrationConflict {
  type: 'type_mismatch' | 'missing_field' | 'reference_ambiguous';
  location: string;
  field: string;
  details: string;
  suggestion: string;
}

export interface MigrationOptions {
  batchSize: number;
  maxNestingDepth: number;
  dryRun: boolean;
  incremental: boolean;
  since?: string;
  createErrorsTable: boolean;
}

export interface MigrationPlan {
  version: string;
  direction: 'mongo_to_postgres' | 'postgres_to_mongo';
  source: { type: DatabaseType; url: string; database: string };
  target: { type: DatabaseType; url: string; database: string };
  tableMappings?: TableMapping[];
  documentMappings?: DocumentMapping[];
  conflicts: MigrationConflict[];
  options: MigrationOptions;
}

export interface TableMigrationResult {
  name: string;
  sourceCount: number;
  targetCount: number;
  failedCount: number;
  status: 'success' | 'partial' | 'failed';
}

export interface MigrationResult {
  success: boolean;
  tables: TableMigrationResult[];
  totalErrors: number;
  duration: number;
  dryRun: boolean;
}

export const DEFAULT_MIGRATION_OPTIONS: MigrationOptions = {
  batchSize: 1000,
  maxNestingDepth: 2,
  dryRun: false,
  incremental: false,
  createErrorsTable: true,
};
