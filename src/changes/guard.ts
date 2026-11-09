import { nanoid } from 'nanoid';
import { schemaSummary } from '@/changes/schema-summary';
import type { GuardOptions, GuardResult, ChangeRecord } from '@/changes/types';
import { guardConfig } from '@/changes/config';
import { saveCheckpoint } from '@/changes/storage';
import { recordMetadata } from '@/changes/metadata';
import { saveRecord, sendRecord, type SendResult } from '@/changes/records';
import { lockDatabase, type LocalDatabase } from '@/changes/database';

export class GuardedChangeError extends Error {
  constructor(
    readonly record: ChangeRecord,
    cause: unknown,
    // Whether the failed change's record reached DBDock Cloud.
    readonly delivery: SendResult = { sent: false },
  ) {
    super(
      `${cause instanceof Error ? cause.message : 'Change failed.'}\nCheckpoint: ${record.checkpointId}\nRecord: ${record.id}`,
      { cause },
    );
    this.name = 'GuardedChangeError';
  }
}

// `prepare` runs once the lock is held and before the checkpoint, so a check
// that refuses the change leaves no checkpoint and no record behind.
export async function runGuardedChange<T>(
  change: (database: LocalDatabase) => Promise<T>,
  options: GuardOptions = {},
  prepare?: (database: LocalDatabase) => Promise<void>,
): Promise<GuardResult<T>> {
  const cwd = options.cwd ?? process.cwd();
  const config = await guardConfig(cwd, options.config);
  const database = await lockDatabase(config);
  try {
    await prepare?.(database);
    const before =
      !options.kind || options.kind === 'migration'
        ? await database.schema()
        : null;
    const scope = await database.scope();
    if (!scope.schemas.length)
      throw new Error(
        'This database user owns no schema DBDock can checkpoint, so the change was not run.',
      );
    const checkpointStarted = Date.now();
    const checkpoint = await saveCheckpoint(config, scope);
    options.onCheckpoint?.(checkpoint, {
      durationMs: Date.now() - checkpointStarted,
      storage: config.storage.provider as 'local' | 's3' | 'r2',
    });
    const metadata = recordMetadata(options, cwd);
    const secrets = [
      config.database.password,
      config.backup?.encryption?.key,
      config.storage.s3?.secretAccessKey,
      config.storage.s3?.accessKeyId,
    ].filter((value): value is string => Boolean(value && value.length >= 4));
    if (secrets.some((secret) => metadata.actor.includes(secret)))
      metadata.actor = metadata.actorKind === 'agent' ? 'Agent' : 'Person';
    if (
      metadata.session &&
      secrets.some((secret) => metadata.session!.includes(secret))
    )
      metadata.session = null;
    if (
      metadata.deploy &&
      secrets.some((secret) => metadata.deploy!.includes(secret))
    )
      metadata.deploy = null;
    const record: ChangeRecord = {
      id: `chg_${nanoid()}`,
      checkpointId: checkpoint.id,
      occurredAt: new Date().toISOString(),
      completedAt: null,
      ...metadata,
      status: 'running',
      checkpointStorage: config.storage.provider as 'local' | 's3' | 'r2',
      restoredCheckpointId: options.restoredCheckpointId ?? null,
    };
    await saveRecord(cwd, record);
    let value: T;
    try {
      value = await change(database);
      record.status = 'succeeded';
    } catch (error) {
      record.status = 'failed';
      record.completedAt = new Date().toISOString();
      await saveRecord(cwd, record);
      throw new GuardedChangeError(
        record,
        error,
        await sendRecord(cwd, record),
      );
    }
    if (before) {
      try {
        record.summary =
          schemaSummary(before, await database.schema()) ?? record.summary;
      } catch {
        record.summary = metadata.summary;
      }
    }
    record.completedAt = new Date().toISOString();
    await saveRecord(cwd, record);
    const delivery = await sendRecord(cwd, record);
    return {
      value,
      record,
      synced: delivery.sent,
      syncError: delivery.reason,
    };
  } finally {
    await database.close();
  }
}
