import { undoCommand } from '@/cli/commands/undo';
import { restoreCheckpointCommand } from '@/cli/commands/restore-checkpoint';
import { findUndoTarget, readHistory } from '@/changes/history';
import { guardConfig } from '@/changes/config';
import type { ChangeRecord, Checkpoint } from '@/changes/types';

jest.mock('@/cli/commands/restore-checkpoint', () => ({
  restoreCheckpointCommand: jest.fn(),
}));
jest.mock('@/changes/history', () => ({
  readHistory: jest.fn(),
  findUndoTarget: jest.fn(),
}));
jest.mock('@/changes/config', () => ({ guardConfig: jest.fn(() => ({})) }));

const record = (summary: string, occurredAt: string): ChangeRecord =>
  ({
    id: 'chg_abcdefghijklmnopqrstu',
    checkpointId: 'cp_abcdefghijklmnopqrstu',
    occurredAt,
    actor: 'ade',
    actorKind: 'person',
    summary,
    status: 'succeeded',
  }) as ChangeRecord;

describe('dbdock undo', () => {
  let out: string[];
  let err: string[];
  beforeEach(() => {
    out = [];
    err = [];
    process.exitCode = undefined;
    jest.clearAllMocks();
    jest
      .spyOn(console, 'log')
      .mockImplementation((text: string) => out.push(text));
    jest
      .spyOn(console, 'error')
      .mockImplementation((text: string) => err.push(text));
    jest.mocked(readHistory).mockResolvedValue({ entries: [] });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('restores the named checkpoint without looking at history', async () => {
    await undoCommand('cp_named_xxxxxxxxxxxxxxx', { yes: true });
    expect(restoreCheckpointCommand).toHaveBeenCalledWith(
      'cp_named_xxxxxxxxxxxxxxx',
      { yes: true },
    );
    expect(readHistory).not.toHaveBeenCalled();
    expect(guardConfig).not.toHaveBeenCalled();
  });

  it('restores the checkpoint saved before the last change', async () => {
    const last = record(
      'Schema changes: 1 table added, 0 tables removed, 3 columns added, 0 columns removed, 0 columns changed',
      '2026-11-06T09:00:00.000Z',
    );
    jest.mocked(findUndoTarget).mockResolvedValue({
      target: {
        record: last,
        checkpoint: { id: last.checkpointId } as Checkpoint,
      },
      skipped: [],
    });

    await undoCommand(undefined, {});

    expect(out.join('\n')).toMatch(
      /Last change: .* · ade · 1 table added, 3 columns added · Succeeded/,
    );
    expect(restoreCheckpointCommand).toHaveBeenCalledWith(
      last.checkpointId,
      {},
    );
  });

  it('says which newer changes it passed over', async () => {
    const target = record('Run SQL', '2026-11-05T09:00:00.000Z');
    jest.mocked(findUndoTarget).mockResolvedValue({
      target: {
        record: target,
        checkpoint: { id: target.checkpointId } as Checkpoint,
      },
      skipped: [
        {
          record: record('Run migration command', '2026-11-06T09:00:00.000Z'),
          reason: 'This checkpoint belongs to a different database.',
        },
      ],
    });

    await undoCommand(undefined, {});

    const text = out.join('\n');
    expect(text).toContain('Passed over:');
    expect(text).toContain('This checkpoint belongs to a different database.');
    expect(text).toMatch(/Undoing: .* · Run SQL/);
    expect(text).not.toContain('Last change:');
  });

  it('explains when there is nothing to undo', async () => {
    jest
      .mocked(findUndoTarget)
      .mockResolvedValue({ target: null, skipped: [] });

    await undoCommand(undefined, {});

    expect(err).toContain('No changes have gone through DBDock yet.');
    expect(restoreCheckpointCommand).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
