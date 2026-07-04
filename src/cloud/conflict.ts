import { LocalSnapshot } from './snapshot';
import { RemoteState } from './types';

export type ConflictStrategy = 'merge' | 'local' | 'cloud' | 'manual';

export interface ConflictReport {
  hasConflict: boolean;
  conflictedKeys: string[];
  localOnlyKeys: string[];
  cloudOnlyKeys: string[];
}

// Three-way detection using `base` (the last-synced resource hashes = common
// ancestor), the current local snapshot, and the remote resource hashes.
// A key is a true conflict only when BOTH sides changed it away from base.
export function detectConflicts(
  base: Record<string, string>,
  local: LocalSnapshot,
  remote: RemoteState,
): ConflictReport {
  const conflictedKeys: string[] = [];
  const localOnlyKeys: string[] = [];
  const cloudOnlyKeys: string[] = [];
  const remoteHashes = remote.resourceHashes || {};

  const keys = new Set<string>([
    ...Object.keys(base),
    ...Object.keys(local.resources),
    ...Object.keys(remoteHashes),
  ]);

  for (const key of keys) {
    const baseHash = base[key];
    const localHash = local.resources[key]?.hash;
    const remoteHash = remoteHashes[key];
    const localChanged = localHash !== baseHash;
    const remoteChanged = remoteHash !== baseHash;

    if (localChanged && remoteChanged && localHash !== remoteHash) {
      conflictedKeys.push(key);
    } else if (localChanged) {
      localOnlyKeys.push(key);
    } else if (remoteChanged) {
      cloudOnlyKeys.push(key);
    }
  }

  return {
    hasConflict: conflictedKeys.length > 0,
    conflictedKeys,
    localOnlyKeys,
    cloudOnlyKeys,
  };
}

// TODO(sync): implement field-level three-way merge and the interactive
// Merge / Keep-Local / Keep-Cloud resolution flow (RFC section 7.5), writing
// overwritten local versions to .dbdock/conflicts/ before applying.
export function resolveConflicts(
  _strategy: ConflictStrategy,
  _report: ConflictReport,
): never {
  throw new Error(
    'Conflict resolution is not implemented yet. Re-run with `dbdock sync --force` to overwrite cloud, or `dbdock sync pull` to adopt cloud.',
  );
}
