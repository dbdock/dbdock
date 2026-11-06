import inquirer from 'inquirer';
import { restoreCheckpointCommand } from '@/cli/commands/restore-checkpoint';
import { restoreCheckpoint } from '@/changes/restore';
import { RestoreRefusedError } from '@/changes/types';
import type { GuardResult, RestorePlan } from '@/changes/types';
import type { RestoreCheckpointOptions } from '@/changes/restore';
import { line } from '@/cli/utils/change-output';

jest.mock('@/changes/restore', () => ({ restoreCheckpoint: jest.fn() }));
jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
}));

const CHECKPOINT = 'cp_abcdefghijklmnopqrstu';
const PLAN: RestorePlan = { replace: ['public'], keep: ['auth', 'storage'] };

// Stands in for restoreCheckpoint: shows the plan, asks, then restores.
async function fakeRestore(
  _id: string,
  options?: RestoreCheckpointOptions,
): Promise<GuardResult<void>> {
  options?.onPlan?.(PLAN);
  if (!options?.confirmLaterWrites && !(await options?.confirm?.(PLAN)))
    throw new RestoreRefusedError('Restore cancelled. Nothing was changed.');
  return {
    value: undefined,
    record: { checkpointId: 'cp_before_restore_xxxxxxx', id: 'chg_x' },
    synced: true,
  } as GuardResult<void>;
}

describe('dbdock restore <checkpoint-id>', () => {
  let out: string[];
  let err: string[];
  const tty = process.stdin.isTTY;

  beforeEach(() => {
    out = [];
    err = [];
    process.exitCode = undefined;
    jest
      .spyOn(console, 'log')
      .mockImplementation((text: string) => out.push(text));
    jest
      .spyOn(console, 'error')
      .mockImplementation((text: string) => err.push(text));
    jest.mocked(restoreCheckpoint).mockImplementation(fakeRestore);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(inquirer.prompt).mockReset();
    process.stdin.isTTY = tty;
    process.exitCode = undefined;
  });

  it('prints what it will replace and leave alone, then restores with --yes', async () => {
    await restoreCheckpointCommand(CHECKPOINT, { yes: true });

    expect(out).toEqual(
      expect.arrayContaining([
        line(' ', 'Will replace:', 'public'),
        line(' ', 'Will not touch:', 'auth, storage'),
        line('✓', 'Restored', CHECKPOINT),
      ]),
    );
    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('asks in a terminal and restores on yes', async () => {
    process.stdin.isTTY = true;
    jest.mocked(inquirer.prompt).mockResolvedValue({ proceed: true });

    await restoreCheckpointCommand(CHECKPOINT, {});

    expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    expect(out).toContain(line('✓', 'Restored', CHECKPOINT));
  });

  it('cancels with exit 73 when the answer is no', async () => {
    process.stdin.isTTY = true;
    jest.mocked(inquirer.prompt).mockResolvedValue({ proceed: false });

    await restoreCheckpointCommand(CHECKPOINT, {});

    expect(err).toContain('Restore cancelled. Nothing was changed.');
    expect(process.exitCode).toBe(73);
  });

  it('refuses without --yes when nobody can answer, naming the flag', async () => {
    process.stdin.isTTY = false;

    await restoreCheckpointCommand(CHECKPOINT, {});

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(err.join('\n')).toContain('Run again with --yes to confirm');
    expect(err.join('\n')).not.toContain('confirmLaterWrites');
    expect(process.exitCode).toBe(73);
  });

  it('exits 1 for any other failure', async () => {
    jest.mocked(restoreCheckpoint).mockRejectedValue(new Error('Disk full'));

    await restoreCheckpointCommand(CHECKPOINT, { yes: true });

    expect(process.exitCode).toBe(1);
  });
});
