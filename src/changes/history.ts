import type { CLIConfig } from '@/cli/utils/config';
import { readProjectConfig } from '@/cloud/project-config';
import { requireSession } from '@/cloud/session';
import { readLocalRecords } from '@/changes/records';
import { readCheckpoint } from '@/changes/storage';
import type { ChangeRecord, Checkpoint } from '@/changes/types';

export interface HistoryEntry {
  record: ChangeRecord;
  // Known to DBDock Cloud: sent from this machine or listed by the API.
  inCloud: boolean;
}

export interface History {
  entries: HistoryEntry[];
  // Set when Cloud could not be read; entries then come from this machine only.
  cloudNote?: string;
}

// How many recent changes undo inspects before giving up. Each one may mean
// reading a checkpoint manifest from the bucket.
const UNDO_SEARCH_LIMIT = 20;

function newestFirst(a: HistoryEntry, b: HistoryEntry): number {
  const time = b.record.occurredAt.localeCompare(a.record.occurredAt);
  return time !== 0 ? time : b.record.id.localeCompare(a.record.id);
}

// Changes saved on this machine plus, when this directory is linked, the
// project's changes in DBDock Cloud. Newest first.
export async function readHistory(cwd: string, limit = 50): Promise<History> {
  const byId = new Map<string, HistoryEntry>();
  for (const { record, synced } of await readLocalRecords(cwd))
    byId.set(record.id, { record, inCloud: synced });

  let cloudNote: string | undefined;
  const project = readProjectConfig(cwd);
  if (!project?.projectId)
    cloudNote =
      'Showing changes saved on this machine. Run npx dbdock link to see changes made from other machines and CI.';
  else
    try {
      const session = await requireSession();
      for (const record of await session.client.listChanges(
        project.projectId,
        limit,
      ))
        byId.set(record.id, {
          record: byId.get(record.id)?.record ?? record,
          inCloud: true,
        });
    } catch (error) {
      cloudNote = `Showing changes saved on this machine. DBDock Cloud could not be read: ${
        error instanceof Error ? error.message : 'unknown error'
      }`;
    }

  return {
    entries: [...byId.values()].sort(newestFirst).slice(0, limit),
    cloudNote,
  };
}

export interface UndoTarget {
  record: ChangeRecord;
  checkpoint: Checkpoint;
}

export interface UndoSearch {
  target: UndoTarget | null;
  // Why each newer change was passed over, newest first.
  skipped: { record: ChangeRecord; reason: string }[];
}

// The newest change whose checkpoint this machine can read and that belongs to
// the database configured here. Checkpoints of other databases, or kept on
// another machine's disk, are passed over and reported.
export async function findUndoTarget(
  config: CLIConfig,
  entries: HistoryEntry[],
): Promise<UndoSearch> {
  const skipped: UndoSearch['skipped'] = [];
  for (const { record } of entries.slice(0, UNDO_SEARCH_LIMIT)) {
    try {
      const checkpoint = await readCheckpoint(config, record.checkpointId);
      return { target: { record, checkpoint }, skipped };
    } catch (error) {
      skipped.push({
        record,
        reason:
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'its checkpoint is not on this machine'
            : error instanceof Error
              ? error.message
              : 'its checkpoint could not be read',
      });
    }
  }
  return { target: null, skipped };
}
