import type { CLIConfig } from '@/cli/utils/config';
import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import { mkdir, mkdtemp, open, rename, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { v2 as cloudinary } from 'cloudinary';
import { getEngine } from '@/engines';
import type { DumpScope } from '@/engines/engine.types';
import { formatFileSize } from '@/utils/format';
import { S3StorageAdapter } from '@/storage/adapters/s3.adapter';
import { ManagedStorageAdapter } from '@/storage/adapters/managed.adapter';
import type { ManagedBroker } from '@/cloud/types';
import { dumpToFile } from '@/standalone/dump-file';

export interface BackupStandaloneDeps {
  managed?: ManagedBroker;
}
export interface BackupProgressCallback {
  onProgress?: (bytesProcessed: number) => void;
  onStage?: (stage: string) => void;
}
export interface BackupResult {
  backupId: string;
  storageKey: string;
  size: number;
  checksum: string;
  formattedSize: string;
  duration: number;
  downloadUrl?: string;
}

export async function createBackupStandalone(
  config: CLIConfig,
  callbacks?: BackupProgressCallback,
  deps?: BackupStandaloneDeps,
  scope?: DumpScope,
): Promise<BackupResult> {
  const started = Date.now();
  const backupId = nanoid();
  const engine = getEngine(config.database.type);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}-${backupId}.${engine.fileExtension(config.backup?.format)}`;
  const local = config.storage.provider === 'local';
  const base = local ? (config.storage.local?.path ?? './backups') : tmpdir();
  await mkdir(base, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(base, '.dbdock-dump-'));
  const path = join(temporary, filename);
  let storageKey = local ? join(base, filename) : `dbdock_backups/${filename}`;
  let downloadUrl: string | undefined;
  try {
    await dumpToFile(config, path, callbacks, scope);
    const { size } = await stat(path);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path))
      digest.update(chunk as Buffer);
    const checksum = digest.digest('hex');
    const file = await open(path, 'r');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    if (local) {
      callbacks?.onStage?.('Saving backup');
      await rename(path, storageKey);
    } else if (
      config.storage.provider === 's3' ||
      config.storage.provider === 'r2'
    ) {
      const s3 =
        config.storage.s3 ??
        (config.storage.r2
          ? {
              ...config.storage.r2,
              region: 'auto',
              endpoint: `https://${config.storage.r2.accountId}.r2.cloudflarestorage.com`,
            }
          : undefined);
      if (!s3) throw new Error('S3/R2 configuration is required.');
      callbacks?.onStage?.('Uploading backup');
      const adapter = new S3StorageAdapter(s3);
      await adapter.uploadStream(createReadStream(path), { key: storageKey });
      try {
        downloadUrl = await adapter.generatePresignedUrl({ key: storageKey });
      } catch {
        downloadUrl = undefined;
      }
    } else if (config.storage.provider === 'managed') {
      if (!deps?.managed)
        throw new Error(
          'DBDock storage needs an active session. Run dbdock login.',
        );
      const uploaded = await new ManagedStorageAdapter(deps.managed).uploadFile(
        path,
        size,
        filename,
      );
      storageKey = uploaded.key;
      try {
        downloadUrl = (await deps.managed.presignDownload(storageKey)).url;
      } catch {
        downloadUrl = undefined;
      }
    } else if (config.storage.provider === 'cloudinary') {
      const settings = config.storage.cloudinary;
      if (!settings) throw new Error('Cloudinary configuration is required.');
      cloudinary.config({
        cloud_name: settings.cloudName,
        api_key: settings.apiKey,
        api_secret: settings.apiSecret,
      });
      storageKey = await new Promise<string>((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream(
          {
            resource_type: 'raw',
            folder: 'dbdock_backups',
            public_id: `backup-${timestamp}-${backupId}`,
          },
          (error, result) =>
            error
              ? reject(new Error(error.message))
              : result?.public_id
                ? resolve(result.public_id)
                : reject(new Error('Storage did not confirm the backup.')),
        );
        const input = createReadStream(path);
        input.on('error', reject);
        upload.on('error', reject);
        input.pipe(upload);
      });
      downloadUrl = cloudinary.url(storageKey, {
        resource_type: 'raw',
        type: 'upload',
      });
    } else
      throw new Error(
        `Unsupported backup storage provider: ${config.storage.provider}`,
      );
    return {
      backupId,
      storageKey,
      size,
      checksum,
      formattedSize: formatFileSize(size),
      duration: Date.now() - started,
      downloadUrl,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
