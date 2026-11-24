import { CLIConfig } from '../cli/utils/config';
import { isManagedSchema, lockDatabase } from './database-lock';
import {
  restoreBackupStandalone,
  type RestoreProgressCallback,
  type RestoreStandaloneDeps,
} from './restore-standalone';

export interface RestoreInPlaceOptions {
  storageKey: string;
  checksum?: string;
}

export interface RestoreInPlaceResult {
  // Postgres schemas the restore replaced or brought back.
  replaced: string[];
  // Postgres schemas it left as they were: the platform's (such as Supabase
  // auth), other roles', and ones created after the backup.
  kept: string[];
}

const POSTGRES = ['postgres', 'postgresql'];
const LOCKED = [...POSTGRES, 'mysql', 'mariadb'];

// Restores a backup onto the database it was taken from, like a checkpoint
// restore. On Postgres it replaces only the app's schemas: those the role may
// replace now, plus ones the backup has that were dropped since. It empties
// them, then restores them with their grants and default privileges. Schemas
// owned by the platform or another role keep everything written after the
// backup, and so do objects that belong to no schema, such as extensions.
// MySQL is emptied and restored whole. Writes made after the backup in the
// replaced schemas are lost.
export async function restoreBackupInPlace(
  config: CLIConfig,
  options: RestoreInPlaceOptions,
  callbacks?: RestoreProgressCallback,
  deps?: RestoreStandaloneDeps,
): Promise<RestoreInPlaceResult> {
  const result: RestoreInPlaceResult = { replaced: [], kept: [] };
  if (!LOCKED.includes(config.database.type)) {
    await restoreBackupStandalone(
      config,
      { ...options, strict: true },
      callbacks,
      deps,
    );
    return result;
  }
  const database = await lockDatabase(config);
  try {
    if (!POSTGRES.includes(config.database.type)) {
      await restoreBackupStandalone(
        config,
        { ...options, strict: true, beforeRestore: () => database.reset() },
        callbacks,
        deps,
      );
      return result;
    }
    await restoreBackupStandalone(
      config,
      {
        ...options,
        strict: true,
        selectSchemas: async (inBackup) => {
          const { existing, restorable } = await database.schemaLists();
          const restore = inBackup.filter(
            (name) =>
              restorable.includes(name) ||
              (!existing.includes(name) && !isManagedSchema(name)),
          );
          result.replaced = restore;
          result.kept = existing.filter((name) => !restore.includes(name));
          return {
            restore,
            create: restore.filter((name) => !existing.includes(name)),
          };
        },
        beforeRestore: (schemas) => database.reset(schemas ?? []),
        restoreFlags: { clean: false, acl: true },
      },
      callbacks,
      deps,
    );
    return result;
  } finally {
    await database.close();
  }
}
