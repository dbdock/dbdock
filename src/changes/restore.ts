import type { GuardOptions, GuardResult, RestorePlan } from '@/changes/types';
import { RESTORE_WARNING, RestoreRefusedError } from '@/changes/types';
import { guardConfig } from '@/changes/config';
import { readCheckpoint } from '@/changes/storage';
import { runGuardedChange } from '@/changes/guard';
import { restoreBackupStandalone } from '@/standalone/restore-standalone';
import { refusedSchemas } from '@/standalone/database-lock';
import { computeKeyFingerprint } from '@/crypto/backup-format';

export interface RestoreCheckpointOptions extends GuardOptions {
  confirmLaterWrites?: boolean;
  // Called with what the restore will replace and leave alone, after the
  // checks pass and before anything is changed.
  onPlan?: (plan: RestorePlan) => void;
}

const POSTGRES_TYPES = ['postgres', 'postgresql'];

export async function restoreCheckpoint(
  id: string,
  options: RestoreCheckpointOptions = {},
): Promise<GuardResult<void>> {
  if (!options.confirmLaterWrites)
    throw new Error(
      `${RESTORE_WARNING} Confirm with confirmLaterWrites: true.`,
    );
  const cwd = options.cwd ?? process.cwd();
  const config = guardConfig(cwd, options.config);
  const checkpoint = await readCheckpoint(config, id);
  const postgres = POSTGRES_TYPES.includes(config.database.type);
  // A 1.3.0 checkpoint is a dump of every schema the role could read, so
  // restoring it would rewrite schemas DBDock must not replace.
  if (postgres && !checkpoint.schemas?.length)
    throw new RestoreRefusedError(
      'This checkpoint was saved by dbdock 1.3.0 and holds the whole database, including schemas DBDock must not replace (such as Supabase auth). It cannot be restored in place. Checkpoints saved from 1.3.1 on can.',
    );
  const replace = checkpoint.schemas ?? [];
  const key = config.backup?.encryption?.key;
  if (
    checkpoint.encrypted &&
    (!key ||
      computeKeyFingerprint(Buffer.from(key, 'hex')).toString('hex') !==
        checkpoint.keyFingerprint)
  )
    throw new Error('Use the encryption key that saved this checkpoint.');
  return runGuardedChange(
    async (database) => {
      const restoreConfig = structuredClone(config);
      restoreConfig.backup = {
        compression: { enabled: checkpoint.compressed },
        encryption: { enabled: checkpoint.encrypted, key },
      };
      await restoreBackupStandalone(restoreConfig, {
        storageKey: checkpoint.storageKey,
        checksum: checkpoint.checksum,
        strict: true,
        beforeRestore: () => database.reset(postgres ? replace : undefined),
        // The reset leaves the replaced schemas empty, so the restore only
        // creates. Grants come back from the checkpoint: same server, same
        // roles.
        restoreFlags: postgres ? { clean: false, acl: true } : undefined,
      });
    },
    {
      ...options,
      config,
      kind: 'restore',
      summary: 'Restore checkpoint',
      restoredCheckpointId: id,
    },
    async (database) => {
      const { existing, restorable } = await database.schemaLists();
      // MySQL has no schemas inside a database; the database is the scope.
      const refused = postgres
        ? refusedSchemas(replace, existing, restorable)
        : [];
      if (refused.length)
        throw new RestoreRefusedError(
          `DBDock may not replace ${refused.join(', ')}: the schema belongs to the platform or another role. Nothing was changed.`,
        );
      options.onPlan?.({
        replace: postgres ? replace : existing,
        keep: postgres
          ? existing.filter((name) => !replace.includes(name))
          : [],
      });
    },
  );
}
