import type { CLIConfig } from '@/cli/utils/config';

export const CHANGE_KINDS = ['migration', 'sql', 'restore', 'copy'] as const;
export const ACTOR_KINDS = ['person', 'agent'] as const;
export const CHANGE_CONTEXTS = ['local', 'ci', 'cloud'] as const;
export const CHANGE_STATUSES = ['running', 'succeeded', 'failed'] as const;
export const RECORD_TEXT_LIMIT = 160;
export const CHECKPOINT_PREFIX = 'dbdock_checkpoints';
export const RESTORE_WARNING =
  'Restoring this checkpoint removes writes made after the checkpoint.';

export interface ChangeRecord {
  id: string;
  checkpointId: string;
  occurredAt: string;
  completedAt: string | null;
  actor: string;
  actorKind: (typeof ACTOR_KINDS)[number];
  context: (typeof CHANGE_CONTEXTS)[number];
  kind: (typeof CHANGE_KINDS)[number];
  summary: string;
  deploy: string | null;
  session: string | null;
  status: (typeof CHANGE_STATUSES)[number];
  checkpointStorage: 'local' | 's3' | 'r2' | 'cloud';
  restoredCheckpointId: string | null;
}

export interface Checkpoint {
  id: string;
  createdAt: string;
  targetHash: string;
  databaseType: string;
  storageKey: string;
  size: number;
  checksum: string;
  encrypted: boolean;
  compressed: boolean;
  keyFingerprint: string | null;
}

export interface GuardOptions {
  config?: CLIConfig;
  cwd?: string;
  kind?: ChangeRecord['kind'];
  actor?: string;
  actorKind?: ChangeRecord['actorKind'];
  deploy?: string;
  session?: string;
  summary?: string;
  restoredCheckpointId?: string;
}

export interface GuardResult<T> {
  value: T;
  record: ChangeRecord;
  synced: boolean;
}
