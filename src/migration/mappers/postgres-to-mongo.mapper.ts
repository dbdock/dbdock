import {
  PgAnalysisResult,
  PgTableAnalysis,
  DocumentMapping,
  EmbedConfig,
  RefConfig,
  MigrationConflict,
  MigrationPlan,
  MigrationOptions,
  DEFAULT_MIGRATION_OPTIONS,
} from '../types';
import { pgTypeToMongoType, pluralize } from '../type.mapper';

interface TableRelationship {
  fromTable: string;
  toTable: string;
  fromColumn: string;
  toColumn: string;
  type: '1:1' | '1:many' | 'many:many';
}

const EMBED_THRESHOLD = 1000;

export function generatePostgresToMongoPlan(
  analysis: PgAnalysisResult,
  sourceUrl: string,
  targetUrl: string,
  options: Partial<MigrationOptions> = {},
): MigrationPlan {
  const mergedOptions = { ...DEFAULT_MIGRATION_OPTIONS, ...options };
  const conflicts: MigrationConflict[] = [];
  const relationships = detectRelationships(analysis);
  const junctionTables = detectJunctionTables(analysis, relationships);
  const childTables = new Set<string>();
  const documentMappings: DocumentMapping[] = [];

  for (const rel of relationships) {
    if (junctionTables.has(rel.fromTable)) continue;
    if (rel.type === '1:1' || rel.type === '1:many') {
      childTables.add(rel.fromTable);
    }
  }

  for (const table of analysis.tables) {
    if (junctionTables.has(table.name)) continue;
    if (childTables.has(table.name)) continue;

    const mapping = mapTableToDocument(
      table,
      analysis,
      relationships,
      junctionTables,
      conflicts,
    );
    documentMappings.push(mapping);
  }

  return {
    version: '1.0.0',
    direction: 'postgres_to_mongo',
    source: {
      type: 'postgresql',
      url: sourceUrl,
      database: analysis.database,
    },
    target: {
      type: 'mongodb',
      url: targetUrl,
      database: extractDbName(targetUrl),
    },
    documentMappings,
    conflicts,
    options: mergedOptions,
  };
}

function extractDbName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, '') || 'test';
  } catch {
    return 'test';
  }
}

function detectRelationships(
  analysis: PgAnalysisResult,
): TableRelationship[] {
  const relationships: TableRelationship[] = [];
  const tableRowCounts = new Map<string, number>();

  for (const table of analysis.tables) {
    tableRowCounts.set(table.name, table.rowCount);
  }

  for (const table of analysis.tables) {
    for (const fk of table.foreignKeys) {
      const fromCount = tableRowCounts.get(table.name) || 0;
      const toCount = tableRowCounts.get(fk.referencedTable) || 0;

      const isUniqueOnFrom = table.columns.find(
        (c) => c.name === fk.columnName,
      )?.isUnique;

      let type: '1:1' | '1:many' | 'many:many';
      if (isUniqueOnFrom) {
        type = '1:1';
      } else if (fromCount > toCount * 0.5) {
        type = '1:many';
      } else {
        type = '1:many';
      }

      relationships.push({
        fromTable: table.name,
        toTable: fk.referencedTable,
        fromColumn: fk.columnName,
        toColumn: fk.referencedColumn,
        type,
      });
    }
  }

  return relationships;
}

function detectJunctionTables(
  analysis: PgAnalysisResult,
  relationships: TableRelationship[],
): Set<string> {
  const junctions = new Set<string>();

  for (const table of analysis.tables) {
    const fks = table.foreignKeys;
    const nonFkColumns = table.columns.filter(
      (c) =>
        !fks.some((fk) => fk.columnName === c.name) && !c.isPrimaryKey,
    );

    if (fks.length === 2 && nonFkColumns.length <= 2) {
      junctions.add(table.name);
    }
  }

  return junctions;
}

function mapTableToDocument(
  table: PgTableAnalysis,
  analysis: PgAnalysisResult,
  relationships: TableRelationship[],
  junctionTables: Set<string>,
  conflicts: MigrationConflict[],
): DocumentMapping {
  const collectionName = table.name;
  const fieldMappings: Record<string, string> = {};
  const embeddings: EmbedConfig[] = [];
  const references: RefConfig[] = [];

  for (const col of table.columns) {
    if (col.isPrimaryKey) {
      fieldMappings[col.name] = '_id';
    } else {
      fieldMappings[col.name] = toCamelCase(col.name);
    }
  }

  const incomingRels = relationships.filter(
    (r) => r.toTable === table.name,
  );

  for (const rel of incomingRels) {
    if (junctionTables.has(rel.fromTable)) {
      const junctionTable = analysis.tables.find(
        (t) => t.name === rel.fromTable,
      );
      if (junctionTable) {
        const otherFk = junctionTable.foreignKeys.find(
          (fk) => fk.referencedTable !== table.name,
        );
        if (otherFk) {
          handleManyToMany(
            table,
            junctionTable,
            otherFk,
            analysis,
            embeddings,
            fieldMappings,
          );
        }
      }
      continue;
    }

    const childTable = analysis.tables.find(
      (t) => t.name === rel.fromTable,
    );
    if (!childTable) continue;

    const shouldEmbed =
      rel.type === '1:1' ||
      (rel.type === '1:many' && childTable.rowCount < EMBED_THRESHOLD);

    if (shouldEmbed) {
      embeddings.push({
        sourceTable: rel.fromTable,
        foreignKey: rel.fromColumn,
        embedAs: rel.type === '1:1' ? toCamelCase(rel.fromTable) : toCamelCase(rel.fromTable),
        isArray: rel.type !== '1:1',
      });
    } else {
      references.push({
        sourceTable: rel.fromTable,
        foreignKey: rel.fromColumn,
        refField: `${toCamelCase(table.name)}Id`,
      });
    }
  }

  return {
    primaryTable: table.name,
    targetCollection: collectionName,
    fieldMappings,
    embeddings,
    references,
  };
}

function handleManyToMany(
  parentTable: PgTableAnalysis,
  junctionTable: PgTableAnalysis,
  otherFk: { referencedTable: string; columnName: string; referencedColumn: string },
  analysis: PgAnalysisResult,
  embeddings: EmbedConfig[],
  fieldMappings: Record<string, string>,
): void {
  const otherTable = analysis.tables.find(
    (t) => t.name === otherFk.referencedTable,
  );
  if (!otherTable) return;

  const hasExtraColumns = junctionTable.columns.filter(
    (c) =>
      !junctionTable.foreignKeys.some((fk) => fk.columnName === c.name) &&
      !c.isPrimaryKey,
  );

  if (hasExtraColumns.length === 0 && otherTable.columns.length <= 3) {
    fieldMappings[`_${otherTable.name}`] = toCamelCase(pluralize(otherTable.name));
  } else {
    embeddings.push({
      sourceTable: junctionTable.name,
      foreignKey: junctionTable.foreignKeys.find(
        (fk) => fk.referencedTable === parentTable.name,
      )?.columnName || '',
      embedAs: toCamelCase(pluralize(otherTable.name)),
      isArray: true,
    });
  }
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
