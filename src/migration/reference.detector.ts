import {
  MongoCollectionAnalysis,
  MongoFieldInfo,
  DetectedReference,
} from './types';
import { singularize, toSnakeCase } from './type.mapper';

export function detectReferences(
  collections: MongoCollectionAnalysis[],
): Map<string, DetectedReference[]> {
  const collectionNames = new Set(collections.map((c) => c.name));
  const result = new Map<string, DetectedReference[]>();

  for (const collection of collections) {
    const refs: DetectedReference[] = [];
    detectFieldReferences(
      collection.fields,
      collection.name,
      collectionNames,
      refs,
    );
    result.set(collection.name, refs);
  }

  return result;
}

function detectFieldReferences(
  fields: MongoFieldInfo[],
  collectionName: string,
  collectionNames: Set<string>,
  refs: DetectedReference[],
): void {
  for (const field of fields) {
    if (field.isObjectId && field.name !== '_id') {
      const targetCollection = guessTargetCollection(
        field.name,
        collectionNames,
      );
      if (targetCollection) {
        refs.push({
          sourceField: field.path,
          targetCollection,
          foreignKeyColumn: toSnakeCase(field.name).replace(/_id$/, '_id'),
          foreignKeyTable: toSnakeCase(collectionName),
        });
      }
    }

    if (field.nestedFields) {
      detectFieldReferences(
        field.nestedFields,
        collectionName,
        collectionNames,
        refs,
      );
    }
  }
}

function guessTargetCollection(
  fieldName: string,
  collectionNames: Set<string>,
): string | null {
  let baseName = fieldName;
  if (baseName.endsWith('Id') || baseName.endsWith('_id')) {
    baseName = baseName.replace(/(_id|Id)$/, '');
  }

  const candidates = [
    baseName,
    baseName + 's',
    baseName + 'es',
    singularize(baseName),
    toSnakeCase(baseName),
    toSnakeCase(baseName) + 's',
  ];

  for (const candidate of candidates) {
    if (collectionNames.has(candidate)) return candidate;
    const lower = candidate.toLowerCase();
    for (const name of collectionNames) {
      if (name.toLowerCase() === lower) return name;
    }
  }

  return null;
}
