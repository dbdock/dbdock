import type { GuardOptions, GuardResult } from '@/changes/types';
import { RESTORE_WARNING } from '@/changes/types';
import { guardConfig } from '@/changes/config';
import { readCheckpoint } from '@/changes/storage';
import { runGuardedChange } from '@/changes/guard';
import { restoreBackupStandalone } from '@/standalone/restore-standalone';
import { computeKeyFingerprint } from '@/crypto/backup-format';

export interface RestoreCheckpointOptions extends GuardOptions {
  confirmLaterWrites?: boolean;
}

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
        beforeRestore: () => database.reset(),
      });
    },
    {
      ...options,
      config,
      kind: 'restore',
      summary: 'Restore checkpoint',
      restoredCheckpointId: id,
    },
  );
}
