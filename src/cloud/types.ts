export interface ProjectConfig {
  projectId: string;
  organizationId?: string | null;
  workspaceId?: string | null;
  createdAt: string;
  version: number;
  sync: {
    enabled: boolean;
    lastSync: string | null;
  };
}

export interface SyncChange {
  op: 'upsert' | 'delete';
  resource: string;
  localId?: string;
  cloudId?: string;
  hash?: string;
  data?: Record<string, unknown>;
}

export interface SyncEvent {
  action: string;
  resourceType?: string;
  metadata?: Record<string, unknown>;
}

export interface PendingJob {
  id: string;
  idempotencyKey: string;
  baseRevision: number;
  changes: SyncChange[];
  events: SyncEvent[];
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
}

export interface LocalState {
  version: number;
  projectId?: string;
  revision: number;
  lastSync: string | null;
  stateHash: string | null;
  resourceHashes: Record<string, string>;
  pending: PendingJob[];
  deadletter: PendingJob[];
  cache: Record<string, unknown>;
}

export interface ProfileConfig {
  apiBaseUrl: string;
  activeOrg?: string | null;
}

export interface GlobalConfig {
  activeProfile: string;
  profiles: Record<string, ProfileConfig>;
}

export interface RemoteState {
  revision: number;
  stateHash: string | null;
  resourceHashes: Record<string, string>;
  lastSyncedAt?: string | null;
}

export interface RemoteProject {
  id: string;
  publicId: string;
  organizationId: string | null;
  name: string;
  slug: string;
  revision: number;
  stateHash: string | null;
}

export interface Identity {
  userId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  authMethod: string;
  organizationId: string | null;
}
