import { CLIConfig } from '../cli/utils/config';
import { Readable, Transform } from 'stream';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  unlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { createBrotliDecompress } from 'zlib';
import { createDecipheriv } from 'crypto';
import { S3StorageAdapter } from '../storage/adapters/s3.adapter';
import { R2StorageAdapter } from '../storage/adapters/r2.adapter';
import { CloudinaryStorageAdapter } from '../storage/adapters/cloudinary.adapter';
import { IStorageAdapter } from '../storage/storage.interface';
import { getEngine } from '../engines';

export interface RestoreProgressCallback {
  onProgress?: (bytesProcessed: number) => void;
  onStage?: (stage: string) => void;
}

export interface RestoreStandaloneOptions {
  storageKey: string;
  target?: CLIConfig['database'];
}

function buildRemoteAdapter(storage: CLIConfig['storage']): IStorageAdapter {
  switch (storage.provider) {
    case 's3': {
      if (!storage.s3?.accessKeyId || !storage.s3?.secretAccessKey) {
        throw new Error('S3 credentials are required');
      }
      return new S3StorageAdapter({
        endpoint: storage.s3.endpoint,
        region: storage.s3.region,
        bucket: storage.s3.bucket || '',
        accessKeyId: storage.s3.accessKeyId,
        secretAccessKey: storage.s3.secretAccessKey,
      });
    }
    case 'r2': {
      if (!storage.s3?.accessKeyId || !storage.s3?.secretAccessKey) {
        throw new Error('R2 credentials are required');
      }
      if (!storage.s3?.endpoint) {
        throw new Error('R2 endpoint is required');
      }
      const accountId = storage.s3.endpoint.match(/https:\/\/([^.]+)/)?.[1];
      if (!accountId) {
        throw new Error('Invalid R2 endpoint format');
      }
      return new R2StorageAdapter({
        accountId,
        bucket: storage.s3.bucket || '',
        accessKeyId: storage.s3.accessKeyId,
        secretAccessKey: storage.s3.secretAccessKey,
      });
    }
    case 'cloudinary': {
      if (
        !storage.cloudinary?.cloudName ||
        !storage.cloudinary?.apiKey ||
        !storage.cloudinary?.apiSecret
      ) {
        throw new Error('Cloudinary credentials are required');
      }
      return new CloudinaryStorageAdapter({
        cloudName: storage.cloudinary.cloudName,
        apiKey: storage.cloudinary.apiKey,
        apiSecret: storage.cloudinary.apiSecret,
        folder: 'dbdock_backups',
      });
    }
    default:
      throw new Error(`Unknown storage provider: ${storage.provider}`);
  }
}

async function openSourceStream(
  config: CLIConfig,
  storageKey: string,
  callbacks: RestoreProgressCallback | undefined,
  tempFiles: string[],
): Promise<Readable> {
  if (callbacks?.onStage) {
    callbacks.onStage('Downloading backup');
  }

  if (config.storage.provider === 'local') {
    const localPath = storageKey.includes('/')
      ? storageKey
      : join(config.storage.local?.path || './backups', storageKey);
    if (!existsSync(localPath)) {
      throw new Error(`Backup file not found: ${localPath}`);
    }
    return createReadStream(localPath);
  }

  const adapter = buildRemoteAdapter(config.storage);
  const tempFilePath = join(
    tmpdir(),
    `dbdock-restore-${randomBytes(8).toString('hex')}.bin`,
  );
  tempFiles.push(tempFilePath);

  const downloadStream = await adapter.downloadStream({ key: storageKey });
  const tempWriteStream = createWriteStream(tempFilePath);

  let downloadedBytes = 0;
  downloadStream.on('data', (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    if (callbacks?.onProgress) {
      callbacks.onProgress(downloadedBytes);
    }
  });

  await new Promise<void>((resolve, reject) => {
    downloadStream.pipe(tempWriteStream);
    downloadStream.on('error', reject);
    tempWriteStream.on('error', reject);
    tempWriteStream.on('finish', resolve);
  });

  return createReadStream(tempFilePath);
}

export async function restoreBackupStandalone(
  config: CLIConfig,
  options: RestoreStandaloneOptions,
  callbacks?: RestoreProgressCallback,
): Promise<void> {
  const engine = getEngine(config.database.type);
  const target = options.target || config.database;
  const tempFiles: string[] = [];

  const cleanup = () => {
    for (const file of tempFiles) {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    }
  };

  try {
    let stream: Readable | Transform = await openSourceStream(
      config,
      options.storageKey,
      callbacks,
      tempFiles,
    );

    if (config.backup?.encryption?.enabled && config.backup.encryption.key) {
      if (callbacks?.onStage) {
        callbacks.onStage('Decrypting backup');
      }
      const keyBuffer = Buffer.from(config.backup.encryption.key, 'hex');
      if (keyBuffer.length !== 32) {
        throw new Error(
          `Invalid encryption key length: ${keyBuffer.length} bytes (expected 32 bytes)`,
        );
      }
      const iv = Buffer.alloc(16);
      const decipher = createDecipheriv('aes-256-cbc', keyBuffer, iv);
      stream = stream.pipe(decipher);
    }

    if (config.backup?.compression?.enabled) {
      if (callbacks?.onStage) {
        callbacks.onStage('Decompressing backup');
      }
      stream = stream.pipe(createBrotliDecompress());
    }

    if (callbacks?.onStage) {
      callbacks.onStage('Restoring to database');
    }

    const restoreProcess = engine.spawnRestore(target);
    stream.pipe(restoreProcess.stdin);

    await new Promise<void>((resolve, reject) => {
      let errorOutput = '';
      let hasWarnings = false;

      stream.on('error', (err: Error) => {
        reject(new Error(`Failed to read backup data: ${err.message}`));
      });

      restoreProcess.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        if (engine.shouldIgnoreRestoreMessage(message)) {
          hasWarnings = true;
        } else if (message.trim()) {
          errorOutput += message;
        }
      });

      restoreProcess.on('error', (err) => {
        reject(
          new Error(
            `Failed to start the restore process: ${err.message}\n\n${engine.clientToolHint}`,
          ),
        );
      });

      restoreProcess.on('close', (code) => {
        if (code === 0 || (code === 1 && !errorOutput && hasWarnings)) {
          resolve();
        } else if (errorOutput) {
          reject(new Error(engine.formatRestoreError(errorOutput)));
        } else {
          reject(new Error(`Restore exited with code ${code}`));
        }
      });
    });
  } finally {
    cleanup();
  }
}
