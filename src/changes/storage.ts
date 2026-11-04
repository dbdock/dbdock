import { Readable } from 'stream';
import { createHash } from 'crypto';
import { mkdir, open, readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { nanoid } from 'nanoid';
import type { CLIConfig } from '@/cli/utils/config';
import type { Checkpoint } from '@/changes/types';
import { CHECKPOINT_PREFIX } from '@/changes/types';
import { createBackupStandalone } from '@/standalone/backup-standalone';
import { S3StorageAdapter } from '@/storage/adapters/s3.adapter';
import { computeKeyFingerprint } from '@/crypto/backup-format';

const CHECKPOINT_ID_PATTERN = /^cp_[a-zA-Z0-9_-]{21}$/;

export function targetHash(config: CLIConfig): string {
  const db = config.database;
  const postgres = ['postgres', 'postgresql'].includes(db.type);
  return createHash('sha256')
    .update(
      JSON.stringify([
        postgres ? 'postgresql' : 'mysql',
        db.host ?? 'localhost',
        db.port ?? (postgres ? 5432 : 3306),
        db.database,
      ]),
    )
    .digest('hex');
}

export function customerStorage(config: CLIConfig): S3StorageAdapter {
  const storage = config.storage;
  const s3 =
    storage.s3 ??
    (storage.r2
      ? {
          ...storage.r2,
          region: 'auto',
          endpoint: `https://${storage.r2.accountId}.r2.cloudflarestorage.com`,
        }
      : undefined);
  if (!s3?.bucket || !s3.accessKeyId || !s3.secretAccessKey)
    throw new Error('Set your bucket and storage credentials locally.');
  return new S3StorageAdapter(s3);
}

export async function ignoreArtifacts(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(join(directory, '.gitignore'), '*\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${nanoid()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

export async function saveCheckpoint(config: CLIConfig): Promise<Checkpoint> {
  if (config.storage.provider === 'local')
    await ignoreArtifacts(config.storage.local!.path);
  const id = `cp_${nanoid()}`;
  const result = await createBackupStandalone(config);
  if (config.storage.provider === 'local') {
    const dump = await open(result.storageKey, 'r');
    try {
      await dump.sync();
    } finally {
      await dump.close();
    }
  }
  const key = config.backup?.encryption?.key;
  const checkpoint: Checkpoint = {
    id,
    createdAt: new Date().toISOString(),
    targetHash: targetHash(config),
    databaseType: config.database.type,
    storageKey: result.storageKey,
    size: result.size,
    checksum: result.checksum,
    encrypted: Boolean(config.backup?.encryption?.enabled),
    compressed: Boolean(config.backup?.compression?.enabled),
    keyFingerprint: key
      ? computeKeyFingerprint(Buffer.from(key, 'hex')).toString('hex')
      : null,
  };
  const manifest = `${CHECKPOINT_PREFIX}/${id}.json`;
  if (config.storage.provider === 'local') {
    const directory = join(config.storage.local!.path, CHECKPOINT_PREFIX);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicJson(join(directory, `${id}.json`), checkpoint);
  } else {
    await customerStorage(config).uploadStream(
      Readable.from(JSON.stringify(checkpoint)),
      { key: manifest },
    );
  }
  return checkpoint;
}

export async function readCheckpoint(
  config: CLIConfig,
  id: string,
): Promise<Checkpoint> {
  if (!CHECKPOINT_ID_PATTERN.test(id))
    throw new Error('Invalid checkpoint id.');
  let contents: string;
  if (config.storage.provider === 'local')
    contents = await readFile(
      join(config.storage.local!.path, CHECKPOINT_PREFIX, `${id}.json`),
      'utf8',
    );
  else {
    const source = await customerStorage(config).downloadStream({
      key: `${CHECKPOINT_PREFIX}/${id}.json`,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of source)
      chunks.push(Buffer.from(chunk as Uint8Array));
    contents = Buffer.concat(chunks).toString('utf8');
  }
  const checkpoint = JSON.parse(contents) as Checkpoint;
  if (
    !/^[a-f0-9]{64}$/.test(checkpoint.checksum) ||
    !Number.isSafeInteger(checkpoint.size) ||
    checkpoint.size <= 0 ||
    typeof checkpoint.storageKey !== 'string' ||
    typeof checkpoint.encrypted !== 'boolean' ||
    typeof checkpoint.compressed !== 'boolean'
  )
    throw new Error('Invalid checkpoint manifest.');
  if (checkpoint.id !== id || checkpoint.targetHash !== targetHash(config))
    throw new Error('This checkpoint belongs to a different database.');
  return checkpoint;
}
