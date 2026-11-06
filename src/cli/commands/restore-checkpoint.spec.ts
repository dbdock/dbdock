import { restoreCheckpointCommand } from '@/cli/commands/restore-checkpoint';
import { restoreCheckpoint } from '@/changes/restore';
import { RestoreRefusedError } from '@/changes/types';
import type { GuardResult } from '@/changes/types';

jest.mock('@/changes/restore', () => ({ restoreCheckpoint: jest.fn() }));

const CHECKPOINT = 'cp_abcdefghijklmnopqrstu';

describe('dbdock restore <checkpoint-id>', () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    process.exitCode = undefined;
    jest
      .spyOn(console, 'error')
      .mockImplementation((line: string) => errors.push(line));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints what it will replace and leave alone before restoring', async () => {
    jest.mocked(restoreCheckpoint).mockImplementation((_id, options) => {
      options?.onPlan?.({ replace: ['public'], keep: ['auth', 'storage'] });
      return Promise.resolve({
        record: { checkpointId: 'cp_before_restore_xxxxxxx' },
        synced: true,
      } as GuardResult<void>);
    });

    await restoreCheckpointCommand(CHECKPOINT, { yes: true });

    expect(errors).toEqual(
      expect.arrayContaining([
        'Will replace: public',
        'Will not touch: auth, storage',
      ]),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('exits 73 when the restore is refused', async () => {
    jest
      .mocked(restoreCheckpoint)
      .mockRejectedValue(new RestoreRefusedError('Refused for a reason.'));

    await restoreCheckpointCommand(CHECKPOINT, { yes: true });

    expect(errors).toContain('Refused for a reason.');
    expect(process.exitCode).toBe(73);
  });

  it('exits 1 for any other failure', async () => {
    jest.mocked(restoreCheckpoint).mockRejectedValue(new Error('Disk full'));

    await restoreCheckpointCommand(CHECKPOINT, { yes: true });

    expect(process.exitCode).toBe(1);
  });
});
