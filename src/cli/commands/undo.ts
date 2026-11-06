import { guardConfig } from '@/changes/config';
import { findUndoTarget, readHistory } from '@/changes/history';
import { restoreCheckpointCommand } from '@/cli/commands/restore-checkpoint';
import {
  line,
  shortSummary,
  statusLabel,
  when,
} from '@/cli/utils/change-output';

// Restores the checkpoint saved before the last change to this database, or
// the one named. Undoing an undo restores the state the undo replaced.
export async function undoCommand(
  id: string | undefined,
  options: { yes?: boolean },
): Promise<void> {
  if (id) return restoreCheckpointCommand(id, options);
  const cwd = process.cwd();
  try {
    const config = guardConfig(cwd);
    const history = await readHistory(cwd);
    const { target, skipped } = await findUndoTarget(config, history.entries);
    if (!target) {
      console.error(
        history.entries.length
          ? 'No recent change has a checkpoint for this database that this machine can read.'
          : 'No changes have gone through DBDock yet.',
      );
      for (const { record, reason } of skipped.slice(0, 5))
        console.error(
          `  ${when(record.occurredAt)} · ${shortSummary(record.summary)}: ${reason}`,
        );
      if (history.cloudNote) console.error(history.cloudNote);
      process.exitCode = 1;
      return;
    }
    const { record } = target;
    // Newer changes were passed over: say so, or "undo" reads as undoing the
    // latest change when it is not.
    for (const passed of skipped.slice(0, 3))
      console.log(
        line(
          ' ',
          'Passed over:',
          `${when(passed.record.occurredAt)} · ${shortSummary(passed.record.summary)}: ${passed.reason}`,
        ),
      );
    console.log(
      line(
        ' ',
        skipped.length ? 'Undoing:' : 'Last change:',
        `${when(record.occurredAt)} · ${record.actor} · ${shortSummary(record.summary)} · ${statusLabel(record.status)}`,
      ),
    );
    await restoreCheckpointCommand(target.checkpoint.id, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Undo failed.');
    process.exitCode = 1;
  }
}
