import {
  MigrationPlan,
  MigrationResult,
  MigrationOptions,
  AnalysisResult,
  ParsedDatabaseUrl,
  DEFAULT_MIGRATION_OPTIONS,
} from '../types';
import { analyzeMongoDB, parseMongoUrl } from '../analyzers/mongodb.analyzer';
import {
  analyzePostgres,
  parsePostgresUrl,
} from '../analyzers/postgres.analyzer';
import { generateMongoToPostgresPlan } from '../mappers/mongo-to-postgres.mapper';
import { generatePostgresToMongoPlan } from '../mappers/postgres-to-mongo.mapper';
import { executeMongoToPostgres } from './mongo-to-postgres.engine';
import { executePostgresToMongo } from './postgres-to-mongo.engine';

export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  if (url.startsWith('mongodb://') || url.startsWith('mongodb+srv://')) {
    return parseMongoUrl(url);
  }
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return parsePostgresUrl(url);
  }
  throw new Error(
    `Unsupported database URL. Expected "mongodb://", "mongodb+srv://", "postgresql://", or "postgres://"`,
  );
}

export async function analyzeDatabase(url: string): Promise<AnalysisResult> {
  const parsed = parseDatabaseUrl(url);

  if (parsed.type === 'mongodb') {
    return analyzeMongoDB(url);
  }

  return analyzePostgres(url);
}

export function generateMigrationPlan(
  analysis: AnalysisResult,
  sourceUrl: string,
  targetUrl: string,
  options: Partial<MigrationOptions> = {},
): MigrationPlan {
  const targetParsed = parseDatabaseUrl(targetUrl);

  if (analysis.type === 'mongodb' && targetParsed.type === 'postgresql') {
    return generateMongoToPostgresPlan(analysis, sourceUrl, targetUrl, options);
  }

  if (analysis.type === 'postgresql' && targetParsed.type === 'mongodb') {
    return generatePostgresToMongoPlan(analysis, sourceUrl, targetUrl, options);
  }

  throw new Error(
    `Unsupported migration direction: ${analysis.type} → ${targetParsed.type}. ` +
      `Supported: MongoDB → PostgreSQL, PostgreSQL → MongoDB`,
  );
}

export async function executeMigration(
  plan: MigrationPlan,
  onProgress?: (table: string, processed: number, total: number) => void,
): Promise<MigrationResult> {
  if (plan.direction === 'mongo_to_postgres') {
    return executeMongoToPostgres(plan, onProgress);
  }

  if (plan.direction === 'postgres_to_mongo') {
    return executePostgresToMongo(plan, onProgress);
  }

  throw new Error(`Unsupported migration direction: ${plan.direction}`);
}

export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
