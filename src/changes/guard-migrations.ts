import { loadConfigFile } from '@/changes/config-file';
import { runGuardedChange } from '@/changes/guard';
import { checkpointLine, deliveryLines } from '@/cli/utils/change-output';

export interface GuardOptionsForCode {
  // Resolve false to run the migrations without a checkpoint, e.g. when none
  // is pending, so a deploy with nothing to apply does not save one.
  when?: () => boolean | Promise<boolean>;
  // Shown in the record when the schema did not change. Default: "Run
  // migrations from code".
  summary?: string;
  actor?: string;
  cwd?: string;
}

// Runs migrations from code the way `dbdock run` runs a command: a checkpoint
// first, then the migrations, then a record. Meant for a migration script run
// once per deploy, not for every instance of an app: two at once collide on
// DBDock's lock and the second throws.
export async function guard<T>(
  migrate: () => T | Promise<T>,
  options: GuardOptionsForCode = {},
): Promise<T> {
  const cwd = options.cwd ?? process.cwd();
  const file = await loadConfigFile(cwd);
  if (file?.config.enabled === false) return migrate();
  if (options.when && !(await options.when())) return migrate();
  const result = await runGuardedChange(async () => migrate(), {
    cwd,
    kind: 'migration',
    summary: options.summary ?? 'Run migrations from code',
    actor: options.actor,
    onCheckpoint: (checkpoint, { durationMs, storage }) =>
      console.log(checkpointLine(checkpoint, durationMs, storage)),
  });
  for (const text of deliveryLines(result.record.id, {
    sent: result.synced,
    reason: result.syncError,
  }))
    (result.synced ? console.log : console.warn)(text);
  return result.value;
}
