import { nanoid } from 'nanoid';
import { schemaSummary } from '@/changes/schema-summary';
import type { GuardOptions, GuardResult, ChangeRecord } from '@/changes/types';
import { guardConfig } from '@/changes/config';
import { saveCheckpoint } from '@/changes/storage';
import { recordMetadata } from '@/changes/metadata';
import { saveRecord, sendRecord } from '@/changes/records';
import { lockDatabase, type LocalDatabase } from '@/changes/database';

export class GuardedChangeError extends Error {
  constructor(
    readonly record: ChangeRecord,
    cause: unknown,
  ) {
    super(
      `${cause instanceof Error ? cause.message : 'Change failed.'}\nCheckpoint: ${record.checkpointId}\nRecord: ${record.id}`,
      { cause },
    );
    this.name = 'GuardedChangeError';
  }
}

export async function runGuardedChange<T>(
  change: (database: LocalDatabase) => Promise<T>,
  options: GuardOptions = {},
): Promise<GuardResult<T>> {
  const cwd = options.cwd ?? process.cwd();
  const config = guardConfig(cwd, options.config);
  const database = await lockDatabase(config);
  try {
    const before =
      !options.kind || options.kind === 'migration'
        ? await database.schema()
        : null;
    const checkpoint = await saveCheckpoint(config);
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
      await sendRecord(cwd, record);
      throw new GuardedChangeError(record, error);
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
    const synced = await sendRecord(cwd, record);
    return { value, record, synced };
  } finally {
    await database.close();
  }
}
