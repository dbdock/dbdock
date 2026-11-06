import { restoreCheckpoint } from '@/changes/restore';
import { RESTORE_WARNING, RestoreRefusedError } from '@/changes/types';

export async function restoreCheckpointCommand(
  id: string,
  options: { yes?: boolean },
): Promise<void> {
  console.error(RESTORE_WARNING);
  try {
    const result = await restoreCheckpoint(id, {
      confirmLaterWrites: options.yes,
      onPlan: ({ replace, keep }) => {
        console.error(`Will replace: ${replace.join(', ')}`);
        console.error(
          `Will not touch: ${keep.length ? keep.join(', ') : 'nothing else'}`,
        );
      },
    });
    console.log(
      `Restored ${id}. Checkpoint before restore: ${result.record.checkpointId}`,
    );
    if (!result.synced)
      console.error(
        'Record saved locally. Run dbdock sync to send it to Cloud.',
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Restore failed.');
    process.exitCode = error instanceof RestoreRefusedError ? 73 : 1;
  }
}
