import { findUndoTarget, readHistory } from '@/changes/history';
import { readLocalRecords } from '@/changes/records';
import { readCheckpoint } from '@/changes/storage';
import { readProjectConfig } from '@/cloud/project-config';
import { requireSession } from '@/cloud/session';
import type { ChangeRecord, Checkpoint } from '@/changes/types';
import type { CLIConfig } from '@/cli/utils/config';

jest.mock('@/changes/records', () => ({ readLocalRecords: jest.fn() }));
jest.mock('@/changes/storage', () => ({ readCheckpoint: jest.fn() }));
jest.mock('@/cloud/project-config', () => ({ readProjectConfig: jest.fn() }));
jest.mock('@/cloud/session', () => ({ requireSession: jest.fn() }));

const record = (id: string, occurredAt: string): ChangeRecord => ({
  id: `chg_${id.padEnd(21, 'x')}`,
  checkpointId: `cp_${id.padEnd(21, 'x')}`,
  occurredAt,
  completedAt: occurredAt,
  actor: 'ade',
  actorKind: 'person',
  context: 'local',
  kind: 'migration',
  summary: 'Run migration command',
  deploy: null,
  session: null,
  status: 'succeeded',
  checkpointStorage: 'local',
  restoredCheckpointId: null,
});

const older = record('older', '2026-11-05T09:00:00.000Z');
const newer = record('newer', '2026-11-06T09:00:00.000Z');
const fromCi = record('fromci', '2026-11-06T10:00:00.000Z');

describe('Change history', () => {
  const listChanges = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(readLocalRecords).mockResolvedValue([
      { record: older, synced: true },
      { record: newer, synced: false },
    ]);
    jest.mocked(requireSession).mockResolvedValue({
      client: { listChanges },
    } as never);
  });

  it('merges this machine with Cloud, newest first', async () => {
    jest
      .mocked(readProjectConfig)
      .mockReturnValue({ projectId: 'proj_x' } as never);
    listChanges.mockResolvedValue([fromCi, older]);

    const history = await readHistory('/repo');

    expect(history.entries.map((entry) => entry.record.id)).toEqual([
      fromCi.id,
      newer.id,
      older.id,
    ]);
    expect(history.entries.map((entry) => entry.inCloud)).toEqual([
      true,
      false,
      true,
    ]);
    expect(history.cloudNote).toBeUndefined();
  });

  it('says when it shows this machine only', async () => {
    jest.mocked(readProjectConfig).mockReturnValue(null as never);
    const history = await readHistory('/repo');
    expect(history.entries).toHaveLength(2);
    expect(history.cloudNote).toContain('npx dbdock link');

    jest
      .mocked(readProjectConfig)
      .mockReturnValue({ projectId: 'proj_x' } as never);
    listChanges.mockRejectedValue(new Error('Not logged in.'));
    expect((await readHistory('/repo')).cloudNote).toContain('Not logged in.');
  });

  it('undoes the newest change whose checkpoint belongs to this database', async () => {
    const checkpoint = { id: older.checkpointId } as Checkpoint;
    jest
      .mocked(readCheckpoint)
      .mockRejectedValueOnce(
        new Error('This checkpoint belongs to a different database.'),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      )
      .mockResolvedValueOnce(checkpoint);

    const search = await findUndoTarget({} as CLIConfig, [
      { record: fromCi, inCloud: true },
      { record: newer, inCloud: false },
      { record: older, inCloud: true },
    ]);

    expect(search.target).toEqual({ record: older, checkpoint });
    expect(search.skipped.map((skip) => skip.reason)).toEqual([
      'This checkpoint belongs to a different database.',
      'its checkpoint is not on this machine',
    ]);
  });

  it('finds nothing when no checkpoint can be read', async () => {
    jest.mocked(readCheckpoint).mockRejectedValue(new Error('Access denied'));
    const search = await findUndoTarget({} as CLIConfig, [
      { record: newer, inCloud: false },
    ]);
    expect(search.target).toBeNull();
    expect(search.skipped[0].reason).toBe('Access denied');
  });
});
