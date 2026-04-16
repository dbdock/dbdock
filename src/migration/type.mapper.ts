import { v5 as uuidv5 } from 'uuid';

const DBDOCK_UUID_NAMESPACE = '9f5b5c5a-7b1a-4e3d-b8f2-1a2b3c4d5e6f';

export function objectIdToUuid(objectId: string): string {
  return uuidv5(objectId, DBDOCK_UUID_NAMESPACE);
}

export function mongoTypeToPgType(mongoType: string): string {
  const typeMap: Record<string, string> = {
    string: 'text',
    number: 'numeric',
    int: 'integer',
    long: 'bigint',
    double: 'double precision',
    decimal: 'numeric',
    boolean: 'boolean',
    date: 'timestamptz',
    objectId: 'uuid',
    binData: 'bytea',
    null: 'text',
    regex: 'text',
    timestamp: 'timestamptz',
    undefined: 'text',
  };
  return typeMap[mongoType] || 'jsonb';
}

export function pgTypeToMongoType(pgType: string): string {
  const normalized = pgType.toLowerCase();

  if (
    ['integer', 'smallint', 'int2', 'int4', 'serial', 'smallserial'].includes(
      normalized,
    )
  )
    return 'int';
  if (['bigint', 'int8', 'bigserial'].includes(normalized)) return 'long';
  if (
    [
      'numeric',
      'decimal',
      'real',
      'float4',
      'double precision',
      'float8',
    ].includes(normalized)
  )
    return 'double';
  if (['boolean', 'bool'].includes(normalized)) return 'bool';
  if (
    [
      'timestamp',
      'timestamptz',
      'timestamp without time zone',
      'timestamp with time zone',
      'date',
      'time',
      'timetz',
    ].includes(normalized)
  )
    return 'date';
  if (['uuid'].includes(normalized)) return 'string';
  if (['jsonb', 'json'].includes(normalized)) return 'object';
  if (['bytea'].includes(normalized)) return 'binData';
  if (normalized.endsWith('[]')) return 'array';

  return 'string';
}

interface BsonLike {
  _bsontype?: string;
  toString?: () => string;
  constructor?: { name?: string };
}

export function detectMongoFieldType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (value > 2147483647 || value < -2147483648) return 'long';
      return 'int';
    }
    return 'double';
  }

  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';

  if (typeof value === 'object') {
    const v = value as BsonLike;
    if (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID')
      return 'objectId';
    if (v._bsontype === 'Decimal128') return 'decimal';
    if (v._bsontype === 'Long') return 'long';
    if (v._bsontype === 'Binary') return 'binData';
    if (v._bsontype === 'Timestamp') return 'timestamp';
    if (v._bsontype === 'BSONRegExp') return 'regex';

    const oid = v.toString?.();
    if (oid && /^[a-f0-9]{24}$/.test(oid) && v.constructor?.name === 'ObjectId')
      return 'objectId';

    return 'object';
  }

  return 'string';
}

export function resolveMajorityType(
  typeCounts: Record<string, number>,
): string {
  const entries = Object.entries(typeCounts).filter(
    ([t]) => t !== 'null' && t !== 'undefined',
  );
  if (entries.length === 0) return 'string';
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function coerceValue(
  value: unknown,
  fromType: string,
  toType: string,
): { success: boolean; value: unknown } {
  try {
    if (value === null || value === undefined)
      return { success: true, value: null };

    if (fromType === toType) return { success: true, value };

    if (
      toType === 'numeric' ||
      toType === 'double precision' ||
      toType === 'integer' ||
      toType === 'bigint'
    ) {
      const num = Number(value);
      if (isNaN(num)) return { success: false, value };
      if (toType === 'integer' && !Number.isInteger(num))
        return { success: true, value: Math.round(num) };
      return { success: true, value: num };
    }

    if (toType === 'text')
      return {
        success: true,
        value:
          value instanceof Date
            ? value.toISOString()
            : typeof value === 'object' && value !== null
              ? JSON.stringify(value)
              : String(value as string | number | boolean),
      };

    if (toType === 'boolean') {
      if (typeof value === 'string') {
        if (['true', '1', 'yes'].includes(value.toLowerCase()))
          return { success: true, value: true };
        if (['false', '0', 'no'].includes(value.toLowerCase()))
          return { success: true, value: false };
        return { success: false, value };
      }
      return { success: true, value: Boolean(value) };
    }

    if (toType === 'timestamptz') {
      const d = new Date(value as string | number | Date);
      if (isNaN(d.getTime())) return { success: false, value };
      return { success: true, value: d };
    }

    if (toType === 'uuid') {
      if (typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)) {
        return { success: true, value: objectIdToUuid(value) };
      }
      if (value && typeof value === 'object') {
        const maybe = value as { toString?: () => string };
        const str = maybe.toString ? maybe.toString() : '';
        if (/^[a-f0-9]{24}$/.test(str)) {
          return { success: true, value: objectIdToUuid(str) };
        }
      }
      return {
        success: true,
        value: String(value as string | number | boolean),
      };
    }

    return { success: true, value };
  } catch {
    return { success: false, value };
  }
}

export function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes'))
    return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s\-.]+/g, '_')
    .toLowerCase();
}

export function pluralize(word: string): string {
  if (word.endsWith('y') && !/[aeiou]y$/.test(word))
    return word.slice(0, -1) + 'ies';
  if (
    word.endsWith('s') ||
    word.endsWith('x') ||
    word.endsWith('z') ||
    word.endsWith('ch') ||
    word.endsWith('sh')
  )
    return word + 'es';
  return word + 's';
}
