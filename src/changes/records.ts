import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { projectDir } from '@/cloud/constants';
import { readProjectConfig } from '@/cloud/project-config';
import { requireSession } from '@/cloud/session';
import { ApiError, NetworkError } from '@/cloud/api-client';
import { atomicJson, ignoreArtifacts } from '@/changes/storage';
import type { ChangeRecord } from '@/changes/types';

export interface LocalRecord {
  record: ChangeRecord;
  synced: boolean;
}

export interface SendResult {
  sent: boolean;
  // Why the record did not reach Cloud, written for the person at the terminal.
  reason?: string;
}

const RECORD_FILE = /^chg_[a-zA-Z0-9_-]{21}\.json$/;

function directory(cwd: string): string {
  return join(projectDir(cwd), 'records');
}

export async function saveRecord(
  cwd: string,
  record: ChangeRecord,
  synced = false,
): Promise<void> {
  await ignoreArtifacts(directory(cwd));
  await atomicJson(join(directory(cwd), `${record.id}.json`), {
    record,
    synced,
  });
}

// Every record saved on this machine, in no particular order.
export async function readLocalRecords(cwd: string): Promise<LocalRecord[]> {
  let files: string[];
  try {
    files = await readdir(directory(cwd));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const entries: LocalRecord[] = [];
  for (const file of files) {
    if (!RECORD_FILE.test(file)) continue;
    entries.push(
      JSON.parse(
        await readFile(join(directory(cwd), file), 'utf8'),
      ) as LocalRecord,
    );
  }
  return entries;
}

function sendFailure(error: unknown): string {
  if (error instanceof ApiError)
    return `DBDock Cloud refused it (HTTP ${error.status}): ${error.message}`;
  if (error instanceof NetworkError)
    return `DBDock Cloud could not be reached: ${error.message}`;
  return error instanceof Error ? error.message : 'Sending failed.';
}

export async function sendRecord(
  cwd: string,
  record: ChangeRecord,
): Promise<SendResult> {
  const project = readProjectConfig(cwd);
  if (!project?.projectId)
    return {
      sent: false,
      reason:
        'This directory is not linked to a DBDock Cloud project. Run npx dbdock link.',
    };
  try {
    const session = await requireSession();
    await session.client.ingestChange(project.projectId, record);
    await saveRecord(cwd, record, true);
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: sendFailure(error) };
  }
}

export async function syncRecords(
  cwd = process.cwd(),
): Promise<{ sent: number; pending: number }> {
  await ignoreArtifacts(directory(cwd));
  let sent = 0;
  let pending = 0;
  for (const entry of await readLocalRecords(cwd)) {
    if (entry.synced) continue;
    if (entry.record.status === 'running') {
      pending++;
      continue;
    }
    if ((await sendRecord(cwd, entry.record)).sent) sent++;
    else pending++;
  }
  return { sent, pending };
}
