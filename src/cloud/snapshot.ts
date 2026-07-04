import { createHash } from 'crypto';

// Canonicalization MUST stay byte-compatible with the backend
// (backend/src/common/utils/canonical-json.ts) so client and server compute the
// same hashes. Keep the two implementations in lockstep.

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return String(value);
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashResource(data: unknown): string {
  return `sha256:${sha256Hex(canonicalStringify(data))}`;
}

export interface ResourceInput {
  resource: string;
  id: string;
  data: Record<string, unknown>;
}

export interface SnapshotEntry {
  hash: string;
  data: Record<string, unknown>;
}

export interface LocalSnapshot {
  resources: Record<string, SnapshotEntry>;
  stateHash: string;
}

export function buildSnapshot(inputs: ResourceInput[]): LocalSnapshot {
  const resources: Record<string, SnapshotEntry> = {};
  for (const input of inputs) {
    const key = `${input.resource}:${input.id}`;
    resources[key] = { hash: hashResource(input.data), data: input.data };
  }
  const hashMap: Record<string, string> = {};
  for (const [key, entry] of Object.entries(resources)) {
    hashMap[key] = entry.hash;
  }
  return {
    resources,
    stateHash: `sha256:${sha256Hex(canonicalStringify(hashMap))}`,
  };
}
