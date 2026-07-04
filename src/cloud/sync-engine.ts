import { randomUUID } from 'crypto';
import { basename } from 'path';
import { ApiError, NetworkError } from './api-client';
import { detectConflicts } from './conflict';
import { diffSnapshot } from './diff';
import { readLocalState, writeLocalState, defaultLocalState } from './local-state';
import {
  newProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from './project-config';
import { buildSnapshot } from './snapshot';
import { collectLocalResources } from './collectors';
import { dueJobs, enqueue, markAcked, markFailed } from './queue';
import { loadSession, requireSession } from './session';
import { LocalState, PendingJob, RemoteProject } from './types';

export class NoProjectError extends Error {
  constructor() {
    super('No linked project. Run `dbdock init` or `dbdock login` then link.');
    this.name = 'NoProjectError';
  }
}

function requireProjectId(cwd: string): string {
  const config = readProjectConfig(cwd);
  if (!config?.projectId) {
    throw new NoProjectError();
  }
  return config.projectId;
}

export async function linkProject(
  cwd: string,
  opts: { name?: string } = {},
): Promise<{ project: RemoteProject; created: boolean }> {
  const session = requireSession();
  const existing = readProjectConfig(cwd);

  if (existing?.projectId) {
    const project = await session.client.getProject(existing.projectId);
    return { project, created: false };
  }

  const name = opts.name || basename(cwd) || 'project';
  const project = await session.client.createProject(
    { name, organizationId: session.activeOrg ?? undefined },
    randomUUID(),
  );

  writeProjectConfig(
    newProjectConfig(
      project.publicId,
      project.organizationId,
      new Date().toISOString(),
    ),
    cwd,
  );

  const state = defaultLocalState(project.publicId);
  state.revision = project.revision;
  state.stateHash = project.stateHash;
  writeLocalState(state, cwd);

  return { project, created: true };
}

export interface SyncStatusResult {
  projectId: string;
  localRevision: number;
  remoteRevision: number | null;
  inSync: boolean;
  pending: number;
  deadletter: number;
  lastSync: string | null;
  remoteReachable: boolean;
}

export async function syncStatus(
  cwd: string = process.cwd(),
): Promise<SyncStatusResult> {
  const projectId = requireProjectId(cwd);
  const state = readLocalState(cwd);
  const session = loadSession();

  let remoteRevision: number | null = null;
  let remoteReachable = false;
  if (session.token) {
    try {
      const remote = await session.client.getState(projectId);
      remoteRevision = remote ? remote.revision : state.revision;
      remoteReachable = true;
    } catch {
      remoteReachable = false;
    }
  }

  return {
    projectId,
    localRevision: state.revision,
    remoteRevision,
    inSync:
      remoteRevision !== null &&
      remoteRevision === state.revision &&
      state.pending.length === 0,
    pending: state.pending.length,
    deadletter: state.deadletter.length,
    lastSync: state.lastSync,
    remoteReachable,
  };
}

export interface SyncPushResult {
  noop: boolean;
  queued: number;
  drained: DrainResult;
}

export async function syncPush(
  cwd: string = process.cwd(),
  opts: { force?: boolean } = {},
): Promise<SyncPushResult> {
  const projectId = requireProjectId(cwd);
  let state = readLocalState(cwd);

  const snapshot = buildSnapshot(collectLocalResources(cwd));
  const changes = diffSnapshot(state.resourceHashes, snapshot);

  let queued = 0;
  if (changes.length > 0) {
    const job: PendingJob = {
      id: `job_${randomUUID()}`,
      idempotencyKey: randomUUID(),
      baseRevision: state.revision,
      changes,
      events: [],
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    state = enqueue(state, job);
    writeLocalState(state, cwd);
    queued = 1;
  }

  const drained = await drain(cwd, { projectId, force: opts.force });
  return {
    noop: changes.length === 0 && drained.attempted === 0,
    queued,
    drained,
  };
}

export interface DrainResult {
  attempted: number;
  acked: number;
  failed: number;
  deadlettered: number;
  conflict: boolean;
  remoteRevision: number | null;
}

export async function drain(
  cwd: string,
  opts: { projectId?: string; force?: boolean } = {},
): Promise<DrainResult> {
  const projectId = opts.projectId ?? requireProjectId(cwd);
  const session = requireSession();
  let state = readLocalState(cwd);

  const result: DrainResult = {
    attempted: 0,
    acked: 0,
    failed: 0,
    deadlettered: 0,
    conflict: false,
    remoteRevision: null,
  };

  for (const job of dueJobs(state)) {
    result.attempted++;
    try {
      const remote = await session.client.getState(projectId);
      const remoteRevision = remote ? remote.revision : state.revision;
      result.remoteRevision = remoteRevision;

      if (remoteRevision !== job.baseRevision && !opts.force) {
        result.conflict = true;
        break;
      }

      const baseRevision = opts.force ? remoteRevision : job.baseRevision;
      const applied = await session.client.pushSync(
        projectId,
        {
          baseRevision,
          clientStateHash: state.stateHash ?? undefined,
          changes: job.changes,
          events: job.events,
        },
        job.idempotencyKey,
      );

      state = applyAck(state, applied);
      state = markAcked(state, job.id);
      writeLocalState(state, cwd);
      result.acked++;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        result.conflict = true;
        break;
      }
      if (err instanceof NetworkError) {
        state = markFailed(state, job.id);
        writeLocalState(state, cwd);
        result.failed++;
        continue;
      }
      const before = state.deadletter.length;
      state = markFailed(state, job.id, 1);
      writeLocalState(state, cwd);
      if (state.deadletter.length > before) {
        result.deadlettered++;
      } else {
        result.failed++;
      }
    }
  }

  return result;
}

function applyAck(
  state: LocalState,
  applied: {
    revision: number;
    stateHash: string;
    resourceHashes: Record<string, string>;
  },
): LocalState {
  return {
    ...state,
    revision: applied.revision,
    stateHash: applied.stateHash,
    resourceHashes: applied.resourceHashes,
    lastSync: new Date().toISOString(),
  };
}

export interface SyncPullResult {
  upToDate: boolean;
  remoteRevision: number;
}

// TODO(sync): apply pulled cloud metadata into local resource files. For now
// pull only refreshes the local cache/baseline (revision + resource hashes) so
// the next push diffs against the authoritative cloud state.
export async function syncPull(
  cwd: string = process.cwd(),
): Promise<SyncPullResult> {
  const projectId = requireProjectId(cwd);
  const session = requireSession();
  let state = readLocalState(cwd);

  const remote = await session.client.getState(projectId);
  if (!remote) {
    return { upToDate: true, remoteRevision: state.revision };
  }

  state = {
    ...state,
    revision: remote.revision,
    stateHash: remote.stateHash,
    resourceHashes: remote.resourceHashes,
    lastSync: new Date().toISOString(),
    cache: { ...state.cache, remoteState: remote },
  };
  writeLocalState(state, cwd);

  return { upToDate: false, remoteRevision: remote.revision };
}

export { detectConflicts };
