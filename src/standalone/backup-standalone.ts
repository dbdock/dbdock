import { CLIConfig } from '../cli/utils/config';
import { spawn } from 'child_process';
import { Readable, Transform, PassThrough } from 'stream';
import { createWriteStream, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { createCipheriv, randomBytes } from 'crypto';
import { createBrotliCompress } from 'zlib';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { v2 as cloudinary } from 'cloudinary';

interface BackupResult {
  backupId: string;
  storageKey: string;
  size: number;
  duration: number;
}

export async function createBackupStandalone(
  config: CLIConfig,
): Promise<BackupResult> {
  const startTime = Date.now();
  const backupId = randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}-${backupId}.sql`;

  const storageKey = config.storage.provider === 'local'
    ? join(config.storage.local?.path || './backups', filename)
    : filename;

  if (config.storage.provider === 'local') {
    const dir = dirname(storageKey);
    mkdirSync(dir, { recursive: true });
  }

  const dbConfig = config.database;
  const pgDumpArgs = [
    '-h', dbConfig.host || 'localhost',
    '-p', String(dbConfig.port || 5432),
    '-U', dbConfig.username || 'postgres',
    '-d', dbConfig.database || 'postgres',
    '-F', 'c',
    '--no-password',
  ];

  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password,
  };

  const pgDumpProcess = spawn('pg_dump', pgDumpArgs, { env });

  let stream: Readable | Transform = pgDumpProcess.stdout;
  const streams: (Readable | Transform)[] = [stream];

  if (config.backup?.compression?.enabled) {
    const compressStream = createBrotliCompress({
      params: {
        [0]: config.backup.compression.level || 6,
      },
    });
    stream = stream.pipe(compressStream);
    streams.push(compressStream);
  }

  if (config.backup?.encryption?.enabled && config.backup.encryption.key) {
    const iv = randomBytes(16);
    const cipher = createCipheriv(
      'aes-256-cbc',
      Buffer.from(config.backup.encryption.key),
      iv,
    );
    stream = stream.pipe(cipher);
    streams.push(cipher);
  }

  let totalSize = 0;
  stream.on('data', (chunk: Buffer) => {
    totalSize += chunk.length;
  });

  if (config.storage.provider === 'local') {
    const writeStream = createWriteStream(storageKey);
    stream.pipe(writeStream);

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
      pgDumpProcess.on('error', reject);
      pgDumpProcess.stderr.on('data', (data) => {
        const message = data.toString();
        if (!message.includes('NOTICE')) {
          console.error('pg_dump error:', message);
        }
      });
    });
  } else if (config.storage.provider === 's3' || config.storage.provider === 'r2') {
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
        Key: filename,
        Body: passThrough,
      },
    });

    await new Promise<void>((resolve, reject) => {
      upload.done()
        .then(() => resolve())
        .catch(reject);

      pgDumpProcess.on('error', reject);
      pgDumpProcess.stderr.on('data', (data) => {
        const message = data.toString();
        if (!message.includes('NOTICE')) {
          console.error('pg_dump error:', message);
        }
      });
    });
  } else if (config.storage.provider === 'cloudinary') {
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
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'dbdock-backups',
          public_id: `backup-${timestamp}-${backupId}`,
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );

      stream.pipe(uploadStream);

      pgDumpProcess.on('error', reject);
      pgDumpProcess.stderr.on('data', (data) => {
        const message = data.toString();
        if (!message.includes('NOTICE')) {
          console.error('pg_dump error:', message);
        }
      });
    });
  } else {
    throw new Error(`Storage provider ${config.storage.provider} not yet implemented in standalone mode`);
  }

  const duration = Date.now() - startTime;

  return {
    backupId,
    storageKey,
    size: totalSize,
    duration,
  };
}
