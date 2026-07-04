import { LocalSnapshot } from './snapshot';
import { SyncChange } from './types';

function parseKey(key: string): { resource: string; id: string } {
  const idx = key.indexOf(':');
  if (idx === -1) {
    return { resource: 'unknown', id: key };
  }
  return { resource: key.slice(0, idx), id: key.slice(idx + 1) };
}

// Delta between the last-synced resource hashes (base) and the current local
// snapshot. Only changed/new/removed resources produce changes.
export function diffSnapshot(
  base: Record<string, string>,
  local: LocalSnapshot,
): SyncChange[] {
  const changes: SyncChange[] = [];

  for (const [key, entry] of Object.entries(local.resources)) {
    if (base[key] !== entry.hash) {
      const { resource, id } = parseKey(key);
      changes.push({
        op: 'upsert',
        resource,
        localId: id,
        hash: entry.hash,
        data: entry.data,
      });
    }
  }

  for (const key of Object.keys(base)) {
    if (!(key in local.resources)) {
      const { resource, id } = parseKey(key);
      changes.push({ op: 'delete', resource, localId: id });
    }
  }

  return changes;
}
