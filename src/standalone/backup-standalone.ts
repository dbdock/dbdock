import { CLIConfig } from '../cli/utils/config';
import { spawn } from 'child_process';
import { Readable, Transform, PassThrough } from 'stream';
import { createWriteStream, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { createCipheriv, randomBytes } from 'crypto';
import { createBrotliCompress } from 'zlib';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { v2 as cloudinary } from 'cloudinary';

interface BackupResult {
  backupId: string;
  storageKey: string;
  size: number;
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
): Promise<BackupResult> {
  const startTime = Date.now();
  const backupId = randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const format = config.backup?.format || 'custom';
  const extensionMap: Record<string, string> = {
    custom: 'sql',
    plain: 'sql',
    directory: 'dir',
    tar: 'tar',
  };
  const extension = extensionMap[format] || 'sql';
  const filename = `backup-${timestamp}-${backupId}.${extension}`;

  let storageKey =
    config.storage.provider === 'local'
      ? join(config.storage.local?.path || './backups', filename)
      : `dbdock_backups/${filename}`;

  if (config.storage.provider === 'local') {
    const dir = dirname(storageKey);
    mkdirSync(dir, { recursive: true });
  }

  const dbConfig = config.database;

  const formatMap: Record<string, string> = {
    custom: 'c',
    plain: 'p',
    directory: 'd',
    tar: 't',
  };

  const pgDumpArgs = [
    '-h',
    dbConfig.host || 'localhost',
    '-p',
    String(dbConfig.port || 5432),
    '-U',
    dbConfig.username || 'postgres',
    '-d',
    dbConfig.database || 'postgres',
    '-F',
    formatMap[format] || 'c',
    '--no-password',
  ];

  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password,
  };

  if (callbacks?.onStage) {
    callbacks.onStage('Dumping database');
  }

  const pgDumpProcess = spawn('pg_dump', pgDumpArgs, { env });

  let stream: Readable | Transform = pgDumpProcess.stdout;
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

    const iv = Buffer.alloc(16);
    const cipher = createCipheriv('aes-256-cbc', keyBuffer, iv);
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
    const writeStream = createWriteStream(storageKey);
    stream.pipe(writeStream);

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => {
        if (pgDumpExitCode !== null && pgDumpExitCode !== 0) {
          reject(
            new Error(
              formatPgDumpError(pgDumpExitCode, pgDumpErrorMessages, dbConfig),
            ),
          );
        } else if (pgDumpErrorMessages.length > 0 && totalSize === 0) {
          reject(
            new Error(formatPgDumpError(1, pgDumpErrorMessages, dbConfig)),
          );
        } else {
          resolve();
        }
      });
      writeStream.on('error', reject);
      pgDumpProcess.on('error', (err) => {
        reject(
          new Error(
            `Failed to execute pg_dump: ${err.message}\n\nPlease ensure PostgreSQL client tools are installed:\n  macOS: brew install postgresql\n  Ubuntu/Debian: sudo apt-get install postgresql-client`,
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
                formatPgDumpError(
                  pgDumpExitCode,
                  pgDumpErrorMessages,
                  dbConfig,
                ),
              ),
            );
          } else if (pgDumpErrorMessages.length > 0 && totalSize === 0) {
            reject(
              new Error(formatPgDumpError(1, pgDumpErrorMessages, dbConfig)),
            );
          } else {
            resolve();
          }
        })
        .catch(reject);

      pgDumpProcess.on('error', (err) => {
        reject(
          new Error(
            `Failed to execute pg_dump: ${err.message}\n\nPlease ensure PostgreSQL client tools are installed:\n  macOS: brew install postgresql\n  Ubuntu/Debian: sudo apt-get install postgresql-client`,
          ),
        );
      });

      pgDumpProcess.on('close', (code) => {
        if (code !== null && code !== 0 && !uploadCompleted) {
          setTimeout(() => {
            if (!uploadCompleted) {
              reject(
                new Error(
                  formatPgDumpError(code, pgDumpErrorMessages, dbConfig),
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
                formatPgDumpError(
                  pgDumpExitCode,
                  pgDumpErrorMessages,
                  dbConfig,
                ),
              ),
            );
          } else if (pgDumpErrorMessages.length > 0 && totalSize === 0) {
            reject(
              new Error(formatPgDumpError(1, pgDumpErrorMessages, dbConfig)),
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
            `Failed to execute pg_dump: ${err.message}\n\nPlease ensure PostgreSQL client tools are installed:\n  macOS: brew install postgresql\n  Ubuntu/Debian: sudo apt-get install postgresql-client`,
          ),
        );
      });

      pgDumpProcess.on('close', (code) => {
        if (code !== null && code !== 0 && !uploadCompleted) {
          setTimeout(() => {
            if (!uploadCompleted) {
              reject(
                new Error(
                  formatPgDumpError(code, pgDumpErrorMessages, dbConfig),
                ),
              );
            }
          }, 1000);
        }
      });
    });
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
  }

  return {
    backupId,
    storageKey,
    size: totalSize,
    duration,
    downloadUrl,
  };
}

function formatPgDumpError(
  exitCode: number,
  errorMessages: string[],
  dbConfig: CLIConfig['database'],
): string {
  const errorMessage = errorMessages.join('\n');
  const host = dbConfig.host || 'localhost';
  const port = dbConfig.port || 5432;
  const username = dbConfig.username || 'postgres';
  const database = dbConfig.database || 'postgres';

  if (
    errorMessage.includes('database') &&
    errorMessage.includes('does not exist')
  ) {
    const dbMatch = errorMessage.match(/database "([^"]+)" does not exist/);
    const dbName = dbMatch ? dbMatch[1] : database;
    return (
      `Database "${dbName}" does not exist\n\n` +
      `Connection details:\n` +
      `  Host: ${host}\n` +
      `  Port: ${port}\n` +
      `  Database: ${dbName}\n\n` +
      `Please verify:\n` +
      `  • Database name is correct in dbdock.config.json\n` +
      `  • Database exists on the server\n` +
      `  • You can connect: psql -h ${host} -p ${port} -U ${username} -d ${dbName}`
    );
  }

  if (
    errorMessage.includes('could not connect') ||
    errorMessage.includes('Connection refused') ||
    errorMessage.includes('ECONNREFUSED')
  ) {
    return (
      `Cannot connect to PostgreSQL server\n\n` +
      `Connection details:\n` +
      `  Host: ${host}\n` +
      `  Port: ${port}\n\n` +
      `Please verify:\n` +
      `  • PostgreSQL server is running\n` +
      `  • Host and port are correct in dbdock.config.json\n` +
      `  • Network/firewall allows connection\n` +
      `  • Test connection: psql -h ${host} -p ${port} -U ${username} -d ${database}`
    );
  }

  if (
    errorMessage.includes('authentication failed') ||
    errorMessage.includes('password authentication failed')
  ) {
    return (
      `Authentication failed for user "${username}"\n\n` +
      `Connection details:\n` +
      `  Host: ${host}\n` +
      `  Port: ${port}\n` +
      `  Username: ${username}\n` +
      `  Database: ${database}\n\n` +
      `Please verify:\n` +
      `  • Username is correct in dbdock.config.json\n` +
      `  • Password is correct in dbdock.config.json\n` +
      `  • User exists and has access to the database\n` +
      `  • Test connection: psql -h ${host} -p ${port} -U ${username} -d ${database}`
    );
  }

  if (errorMessage.includes('permission denied')) {
    return (
      `Permission denied for user "${username}"\n\n` +
      `The user does not have sufficient privileges to perform backup.\n\n` +
      `Please verify:\n` +
      `  • User has read permissions on the database\n` +
      `  • User has necessary privileges for pg_dump\n` +
      `  • Grant access: GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${username};`
    );
  }

  if (errorMessage.includes('no password supplied')) {
    return (
      `No password provided for user "${username}"\n\n` +
      `Please add the database password to dbdock.config.json:\n` +
      `  "database": {\n` +
      `    "password": "your-database-password"\n` +
      `  }`
    );
  }

  if (errorMessages.length > 0) {
    return (
      `pg_dump failed with exit code ${exitCode}\n\n` +
      `Error details:\n${errorMessage}\n\n` +
      `Connection settings:\n` +
      `  Host: ${host}\n` +
      `  Port: ${port}\n` +
      `  Username: ${username}\n` +
      `  Database: ${database}\n\n` +
      `Please check your configuration and database connection.`
    );
  }

  return `pg_dump failed with exit code ${exitCode}. Please check your database configuration.`;
}
