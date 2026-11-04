import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { projectDir } from '@/cloud/constants';
import { readProjectConfig } from '@/cloud/project-config';
import { requireSession } from '@/cloud/session';
import { atomicJson, ignoreArtifacts } from '@/changes/storage';
import type { ChangeRecord } from '@/changes/types';

interface LocalRecord {
  record: ChangeRecord;
  synced: boolean;
}

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

export async function sendRecord(
  cwd: string,
  record: ChangeRecord,
): Promise<boolean> {
  const project = readProjectConfig(cwd);
  if (!project?.projectId) return false;
  try {
    const session = await requireSession();
    await session.client.ingestChange(project.projectId, record);
    await saveRecord(cwd, record, true);
    return true;
  } catch {
    return false;
  }
}

export async function syncRecords(
  cwd = process.cwd(),
): Promise<{ sent: number; pending: number }> {
  await ignoreArtifacts(directory(cwd));
  let sent = 0;
  let pending = 0;
  for (const file of await readdir(directory(cwd))) {
    if (!/^chg_[a-zA-Z0-9_-]{21}\.json$/.test(file)) continue;
    const entry = JSON.parse(
      await readFile(join(directory(cwd), file), 'utf8'),
    ) as LocalRecord;
    if (!entry.synced) {
      if (entry.record.status === 'running') {
        pending++;
        continue;
      }
      if (await sendRecord(cwd, entry.record)) sent++;
      else pending++;
    }
  }
  return { sent, pending };
}
