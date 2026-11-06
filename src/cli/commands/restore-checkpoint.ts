import inquirer from 'inquirer';
import { restoreCheckpoint } from '@/changes/restore';
import { RESTORE_WARNING, RestoreRefusedError } from '@/changes/types';
import { deliveryLines, line } from '@/cli/utils/change-output';

// Asks in a terminal. Anywhere else (CI, a pipe) there is nobody to ask, so the
// restore is refused unless --yes was given.
async function confirmInTerminal(): Promise<boolean> {
  if (!process.stdin.isTTY)
    throw new RestoreRefusedError(
      `${RESTORE_WARNING} Run again with --yes to confirm. Nothing was changed.`,
    );
  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: 'confirm',
      name: 'proceed',
      default: false,
      message: 'Writes made after the checkpoint will be lost. Restore?',
    },
  ]);
  return proceed;
}

export async function restoreCheckpointCommand(
  id: string,
  options: { yes?: boolean },
): Promise<void> {
  try {
    const result = await restoreCheckpoint(id, {
      confirmLaterWrites: options.yes,
      confirm: options.yes ? undefined : confirmInTerminal,
      onPlan: ({ replace, keep }) => {
        console.log(line(' ', 'Will replace:', replace.join(', ')));
        console.log(
          line(
            ' ',
            'Will not touch:',
            keep.length ? keep.join(', ') : 'nothing else',
          ),
        );
        if (options.yes) console.log(line(' ', 'Confirmed:', RESTORE_WARNING));
      },
    });
    console.log(line('✓', 'Restored', id));
    console.log(
      line(
        ' ',
        'Saved first:',
        `${result.record.checkpointId} (the state before this restore)`,
      ),
    );
    for (const text of deliveryLines(result.record.id, {
      sent: result.synced,
      reason: result.syncError,
    }))
      (result.synced ? console.log : console.error)(text);
    console.log(line(' ', 'To undo this:', 'npx dbdock undo'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Restore failed.');
    process.exitCode = error instanceof RestoreRefusedError ? 73 : 1;
  }
}
