import { changesCommand } from '@/cli/commands/changes';
import { readHistory } from '@/changes/history';
import type { ChangeRecord } from '@/changes/types';

jest.mock('@/changes/history', () => ({ readHistory: jest.fn() }));

const record: ChangeRecord = {
  id: 'chg_abcdefghijklmnopqrstu',
  checkpointId: 'cp_abcdefghijklmnopqrstu',
  occurredAt: '2026-11-06T09:00:00.000Z',
  completedAt: '2026-11-06T09:00:05.000Z',
  actor: 'claude-code',
  actorKind: 'agent',
  context: 'local',
  kind: 'sql',
  summary: 'SQL operations: UPDATE, DELETE',
  deploy: null,
  session: 'agent-session',
  status: 'failed',
  checkpointStorage: 'r2',
  restoredCheckpointId: null,
};

describe('dbdock changes', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    jest
      .spyOn(console, 'log')
      .mockImplementation((text: string) => out.push(text));
  });
  afterEach(() => jest.restoreAllMocks());

  it('lists who changed what, its status and its checkpoint', async () => {
    jest
      .mocked(readHistory)
      .mockResolvedValue({ entries: [{ record, inCloud: false }] });

    await changesCommand({});

    expect(out[0]).toMatch(/^When\s+Who\s+Change\s+Status\s+Checkpoint$/);
    expect(out[1]).toContain('claude-code (agent)');
    expect(out[1]).toContain('SQL operations: UPDATE, DELETE');
    expect(out[1]).toContain('Failed, not sent');
    expect(out[1]).toContain('cp_abcdefghijklmnopqrstu (R2 bucket)');
    expect(out).toContain(
      'Changes made directly with the database URL are not recorded.',
    );
  });

  it('shows the empty state and what it cannot see', async () => {
    jest.mocked(readHistory).mockResolvedValue({
      entries: [],
      cloudNote: 'Showing changes saved on this machine.',
    });

    await changesCommand({ limit: 5 });

    expect(readHistory).toHaveBeenCalledWith(process.cwd(), 5);
    expect(out).toEqual([
      'No changes have gone through DBDock yet.',
      'Showing changes saved on this machine.',
      'Changes made directly with the database URL are not recorded.',
    ]);
  });
});
