import { CLIConfig } from '../cli/utils/config';
import { Readable, Transform, PassThrough } from 'stream';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import { createBrotliCompress } from 'zlib';
import { createBackupEncryptStream } from '../crypto/backup-crypto';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { v2 as cloudinary } from 'cloudinary';
import { formatFileSize } from '../utils/format';
import { getEngine } from '../engines';
import { ManagedStorageAdapter } from '../storage/adapters/managed.adapter';
import { ManagedBroker } from '../cloud/types';

export interface BackupStandaloneDeps {
  managed?: ManagedBroker;
}

interface BackupResult {
  backupId: string;
  storageKey: string;
  size: number;
  formattedSize: string;
  duration: number;
  downloadUrl?: string;
}

export interface BackupProgressCallback {
  onProgress?: (bytesProcessed: number) => void;
  onStage?: (stage: string) => void;
}

export async function createBackupStandalone(
  config: CLIConfig,
  callbacks?: BackupProgressCallback,
  deps?: BackupStandaloneDeps,
): Promise<BackupResult> {
  const startTime = Date.now();
  const backupId = randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const engine = getEngine(config.database.type);
  const format = config.backup?.format || 'custom';
  const extension = engine.fileExtension(format);
  const filename = `backup-${timestamp}-${backupId}.${extension}`;

  let storageKey =
    config.storage.provider === 'local'
      ? join(config.storage.local?.path || './backups', filename)
      : `dbdock_backups/${filename}`;

  if (config.storage.provider === 'local') {
    const dir = dirname(storageKey);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const dbConfig = config.database;

  if (callbacks?.onStage) {
    callbacks.onStage('Dumping database');
  }

  const dump = engine.spawnDump(dbConfig, { format });
  const pgDumpProcess = dump.process;

  let stream: Readable | Transform = dump.stdout;
  const streams: (Readable | Transform)[] = [stream];

  const pgDumpErrorMessages: string[] = [];
  let pgDumpExitCode: number | null = null;

  pgDumpProcess.stderr.on('data', (data) => {
    const message = (data as Buffer).toString().trim();
    if (!message.includes('NOTICE') && message) {
      pgDumpErrorMessages.push(message);
    }
  });

  pgDumpProcess.on('close', (code) => {
    pgDumpExitCode = code;
  });

  if (config.backup?.compression?.enabled) {
    if (callbacks?.onStage) {
      callbacks.onStage('Compressing backup');
    }
    const compressStream = createBrotliCompress({
      params: {
        [0]: config.backup.compression.level || 6,
      },
    });
    stream = stream.pipe(compressStream);
    streams.push(compressStream);
  }

  if (config.backup?.encryption?.enabled && config.backup.encryption.key) {
    if (callbacks?.onStage) {
      callbacks.onStage('Encrypting backup');
    }
    const keyBuffer = Buffer.from(config.backup.encryption.key, 'hex');

    if (keyBuffer.length !== 32) {
      throw new Error(
        `Invalid encryption key length: ${keyBuffer.length} bytes (expected 32 bytes)\n\n` +
          `Your key: "${config.backup.encryption.key}" (${config.backup.encryption.key.length} characters)\n\n` +
          `Please fix:\n` +
          `  • Encryption key must be exactly 64 hexadecimal characters (32 bytes)\n` +
          `  • Generate a valid key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n` +
          `  • Update the "backup.encryption.key" in your dbdock.config.json`,
      );
    }

    const cipher = createBackupEncryptStream(keyBuffer);
    stream = stream.pipe(cipher);
    streams.push(cipher);
  }

  let totalSize = 0;
  stream.on('data', (chunk: Buffer) => {
    totalSize += chunk.length;
    if (callbacks?.onProgress) {
      callbacks.onProgress(totalSize);
    }
  });

  if (config.storage.provider === 'local') {
    if (callbacks?.onStage) {
      callbacks.onStage('Writing to local storage');
    }
    const writeStream = createWriteStream(storageKey, { mode: 0o600 });
    stream.pipe(writeStream);

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => {
        if (pgDumpExitCode !== null && pgDumpExitCode !== 0) {
          reject(
            new Error(
              engine.formatDumpError(
                pgDumpExitCode,
                pgDumpErrorMessages,
                dbConfig,
              ),
            ),
          );
        } else if (pgDumpErrorMessages.length > 0 && totalSize === 0) {
          reject(
            new Error(engine.formatDumpError(1, pgDumpErrorMessages, dbConfig)),
          );
        } else {
          resolve();
        }
      });
      writeStream.on('error', reject);
      pgDumpProcess.on('error', (err) => {
        reject(
          new Error(
            `Failed to start the database dump: ${err.message}\n\n${engine.clientToolHint}`,
          ),
        );
      });
    });
  } else if (
    config.storage.provider === 's3' ||
    config.storage.provider === 'r2'
  ) {
    if (callbacks?.onStage) {
      callbacks.onStage(
        `Uploading to ${config.storage.provider.toUpperCase()}`,
      );
    }
    const s3Config = config.storage.s3;
    if (!s3Config) {
      throw new Error('S3/R2 configuration is required');
    }

    const s3Client = new S3Client({
      region: s3Config.region || 'us-east-1',
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      ...(s3Config.endpoint && { endpoint: s3Config.endpoint }),
    });

    const passThrough = new PassThrough();
    stream.pipe(passThrough);

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: s3Config.bucket,
        Key: storageKey,
        Body: passThrough,
      },
    });

    await new Promise<void>((resolve, reject) => {
      let uploadCompleted = false;

      upload
        .done()
        .then(() => {
          uploadCompleted = true;
          if (pgDumpExitCode !== null && pgDumpExitCode !== 0) {
            reject(
              new Error(
                engine.formatDumpError(
                  pgDumpExitCode,
                  pgDumpErrorMessages,
                  dbConfig,
                ),
              ),
            );
          } else if (pgDumpErrorMessages.length > 0 && totalSize === 0) {
            reject(
              new Error(
                engine.formatDumpError(1, pgDumpErrorMessages, dbConfig),
              ),
            );
          } else {
            resolve();
          }
        })
        .catch(reject);

      pgDumpProcess.on('error', (err) => {
        reject(
          new Error(
            `Failed to start the database dump: ${err.message}\n\n${engine.clientToolHint}`,
          ),
        );
      });

      pgDumpProcess.on('close', (code) => {
        if (code !== null && code !== 0 && !uploadCompleted) {
          setTimeout(() => {
            if (!uploadCompleted) {
              reject(
                new Error(
                  engine.formatDumpError(code, pgDumpErrorMessages, dbConfig),
                ),
              );
            }
          }, 1000);
        }
      });
    });
  } else if (config.storage.provider === 'cloudinary') {
    if (callbacks?.onStage) {
      callbacks.onStage('Uploading to Cloudinary');
    }
    const cloudinaryConfig = config.storage.cloudinary;
    if (!cloudinaryConfig) {
      throw new Error('Cloudinary configuration is required');
    }

    cloudinary.config({
      cloud_name: cloudinaryConfig.cloudName,
      api_key: cloudinaryConfig.apiKey,
      api_secret: cloudinaryConfig.apiSecret,
    });

    await new Promise<void>((resolve, reject) => {
      let uploadCompleted = false;

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'dbdock_backups',
          public_id: `backup-${timestamp}-${backupId}`,
        },
        (error, result) => {
          uploadCompleted = true;
          if (error) {
            reject(new Error(error.message));
          } else if (pgDumpExitCode !== null && pgDumpExitCode !== 0) {
            reject(
              new Error(
                engine.formatDumpError(
                  pgDumpExitCode,
                  pgDumpErrorMessages,
                  dbConfig,
                ),
              ),
            );
          } else if (pgDumpErrorMessages.length > 0 && totalSize === 0) {
            reject(
              new Error(
                engine.formatDumpError(1, pgDumpErrorMessages, dbConfig),
              ),
            );
          } else {
            if (result?.public_id) {
              storageKey = result.public_id;
            }
            resolve();
          }
        },
      );

      stream.pipe(uploadStream);

      pgDumpProcess.on('error', (err) => {
        reject(
          new Error(
            `Failed to start the database dump: ${err.message}\n\n${engine.clientToolHint}`,
          ),
        );
      });

      pgDumpProcess.on('close', (code) => {
        if (code !== null && code !== 0 && !uploadCompleted) {
          setTimeout(() => {
            if (!uploadCompleted) {
              reject(
                new Error(
                  engine.formatDumpError(code, pgDumpErrorMessages, dbConfig),
                ),
              );
            }
          }, 1000);
        }
      });
    });
  } else if (config.storage.provider === 'managed') {
    if (!deps?.managed) {
      throw new Error(
        'DBDock storage needs an active session. Run `dbdock login` and try again.',
      );
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'dbdock-managed-'));
    const tempPath = join(tempDir, filename);
    const writeStream = createWriteStream(tempPath, { mode: 0o600 });
    stream.pipe(writeStream);

    try {
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', () => {
          if (pgDumpExitCode !== null && pgDumpExitCode !== 0) {
            reject(
              new Error(
                engine.formatDumpError(
                  pgDumpExitCode,
                  pgDumpErrorMessages,
                  dbConfig,
                ),
              ),
            );
          } else if (pgDumpErrorMessages.length > 0 && totalSize === 0) {
            reject(
              new Error(
                engine.formatDumpError(1, pgDumpErrorMessages, dbConfig),
              ),
            );
          } else {
            resolve();
          }
        });
        writeStream.on('error', reject);
        pgDumpProcess.on('error', (err) => {
          reject(
            new Error(
              `Failed to start the database dump: ${err.message}\n\n${engine.clientToolHint}`,
            ),
          );
        });
      });

      if (callbacks?.onStage) {
        callbacks.onStage('Uploading to DBDock storage');
      }

      const adapter = new ManagedStorageAdapter(deps.managed);
      const uploaded = await adapter.uploadFile(tempPath, totalSize, filename);
      storageKey = uploaded.key;
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best effort temp cleanup
      }
    }
  } else {
    throw new Error(
      `Storage provider ${config.storage.provider} not yet implemented in standalone mode`,
    );
  }

  const duration = Date.now() - startTime;

  let downloadUrl: string | undefined;

  if (config.storage.provider === 's3' || config.storage.provider === 'r2') {
    try {
      const s3Config = config.storage.s3;
      if (s3Config) {
        const s3Client = new S3Client({
          region: s3Config.region || 'us-east-1',
          credentials: {
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
          },
          ...(s3Config.endpoint && { endpoint: s3Config.endpoint }),
        });

        const command = new GetObjectCommand({
          Bucket: s3Config.bucket,
          Key: storageKey,
        });

        downloadUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 604800,
        });
      }
    } catch {
      downloadUrl = undefined;
    }
  } else if (config.storage.provider === 'cloudinary') {
    downloadUrl = cloudinary.url(storageKey, {
      resource_type: 'raw',
      type: 'upload',
    });
  } else if (config.storage.provider === 'managed' && deps?.managed) {
    try {
      const presigned = await deps.managed.presignDownload(storageKey);
      downloadUrl = presigned.url;
    } catch {
      downloadUrl = undefined;
    }
  }

  return {
    backupId,
    storageKey,
    size: totalSize,
    formattedSize: formatFileSize(totalSize),
    duration,
    downloadUrl,
  };
}
