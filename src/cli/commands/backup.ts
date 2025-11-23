import ora from 'ora';
import { loadConfig, CLIConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { createBackupStandalone } from '../../standalone/backup-standalone';
import { Logger } from '@nestjs/common';
import { ProgressTracker } from '../utils/progress';
import { applyRetention, formatRetentionStats } from '../utils/retention';
import { LocalStorageAdapter } from '../../storage/adapters/local.adapter';
import { S3StorageAdapter } from '../../storage/adapters/s3.adapter';
import { CloudinaryStorageAdapter } from '../../storage/adapters/cloudinary.adapter';
import { IStorageAdapter } from '../../storage/storage.interface';

Logger.overrideLogger(false);

interface BackupOptions {
  encrypt?: boolean;
  compress?: boolean;
  encryptionKey?: string;
  compressionLevel?: number;
}

export async function backupCommand(options: BackupOptions): Promise<void> {
  const spinner = ora('Loading configuration...').start();

  try {
    const config = loadConfig();

    const mergedConfig: CLIConfig = {
      ...config,
      backup: {
        ...config.backup,
        encryption: {
          enabled: options.encrypt !== undefined ? options.encrypt : (config.backup?.encryption?.enabled || false),
          key: options.encryptionKey || config.backup?.encryption?.key,
        },
        compression: {
          enabled: options.compress !== undefined ? options.compress : (config.backup?.compression?.enabled || false),
          level: options.compressionLevel || config.backup?.compression?.level,
        },
      },
    };

    if (mergedConfig.backup?.encryption?.enabled && !mergedConfig.backup.encryption.key) {
      spinner.fail('Encryption enabled but no key provided');
      logger.error('\nPlease provide an encryption key:\n');
      logger.log('  Option 1: Add to config file (dbdock.config.json):');
      logger.log('    "backup": { "encryption": { "key": "YOUR_64_CHAR_HEX_KEY" } }\n');
      logger.log('  Option 2: Use CLI flag:');
      logger.log('    npx dbdock backup --encryption-key YOUR_64_CHAR_HEX_KEY\n');
      logger.log('  Generate a key:');
      logger.log('    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
      process.exit(1);
    }

    if (mergedConfig.backup?.encryption?.key) {
      const key = mergedConfig.backup.encryption.key;
      if (key.length !== 64) {
        spinner.fail('Invalid encryption key length');
        logger.error(`\nYour key has ${key.length} characters, but must be exactly 64 hexadecimal characters (32 bytes)\n`);
        logger.log('Please fix:\n');
        logger.log('  Generate a valid key:');
        logger.log('    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
        logger.log('  Update your dbdock.config.json:');
        logger.log('    "backup": { "encryption": { "key": "PASTE_64_CHAR_KEY_HERE" } }');
        process.exit(1);
      }

      if (!/^[0-9a-fA-F]{64}$/.test(key)) {
        spinner.fail('Invalid encryption key format');
        logger.error('\nEncryption key must contain only hexadecimal characters (0-9, a-f, A-F)\n');
        logger.log('Please fix:\n');
        logger.log('  Generate a valid key:');
        logger.log('    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
        logger.log('  Update your dbdock.config.json:');
        logger.log('    "backup": { "encryption": { "key": "PASTE_64_CHAR_KEY_HERE" } }');
        process.exit(1);
      }
    }

    spinner.succeed('Configuration validated');

    const progress = new ProgressTracker();
    let currentStage = 'Starting';

    progress.start(100, 'Preparing backup');

    const result = await createBackupStandalone(mergedConfig, {
      onProgress: (bytes) => {
        const mb = bytes / 1024 / 1024;
        progress.update(Math.min(mb, 100), currentStage);
      },
      onStage: (stage) => {
        currentStage = stage;
      },
    });

    progress.stop('Backup complete');
    console.log('');
    logger.success('Backup completed successfully');
    logger.success(`Backup ID: ${result.backupId}`);
    logger.info(`Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`Duration: ${result.duration}ms`);
    if (mergedConfig.backup?.encryption?.enabled) {
      logger.info('Encryption: enabled');
    }
    if (mergedConfig.backup?.compression?.enabled) {
      logger.info(`Compression: enabled (level ${mergedConfig.backup.compression.level || 6})`);
    }

    logger.info(`\nStorage Location:`);
    if (mergedConfig.storage.provider === 'local') {
      logger.log(`  Local path: ${result.storageKey}`);
    } else if (mergedConfig.storage.provider === 's3') {
      const s3Config = mergedConfig.storage.s3;
      const region = s3Config?.region || 'us-east-1';
      const bucket = s3Config?.bucket || '';
      logger.log(`  Provider: AWS S3`);
      logger.log(`  Bucket: ${bucket}`);
      logger.log(`  Region: ${region}`);
      logger.log(`  Key: ${result.storageKey}`);
      if (result.downloadUrl) {
        logger.log(`  Download URL: ${result.downloadUrl}`);
      }
      logger.log(`  Console: https://s3.console.aws.amazon.com/s3/object/${bucket}?region=${region}&prefix=${result.storageKey}`);
    } else if (mergedConfig.storage.provider === 'r2') {
      const s3Config = mergedConfig.storage.s3;
      const bucket = s3Config?.bucket || '';
      const accountId = s3Config?.endpoint?.match(/https:\/\/([^.]+)/)?.[1] || '';
      logger.log(`  Provider: Cloudflare R2`);
      logger.log(`  Bucket: ${bucket}`);
      logger.log(`  Key: ${result.storageKey}`);
      if (result.downloadUrl) {
        logger.log(`  Download URL: ${result.downloadUrl}`);
      }
      if (accountId) {
        logger.log(`  Dashboard: https://dash.cloudflare.com/${accountId}/r2/default/buckets/${bucket}`);
      }
    } else if (mergedConfig.storage.provider === 'cloudinary') {
      const cloudinaryConfig = mergedConfig.storage.cloudinary;
      const cloudName = cloudinaryConfig?.cloudName || '';
      logger.log(`  Provider: Cloudinary`);
      logger.log(`  Cloud: ${cloudName}`);
      logger.log(`  Resource ID: ${result.storageKey}`);
      if (result.downloadUrl) {
        logger.log(`  Download URL: ${result.downloadUrl}`);
      }
      logger.log(`  Console: https://console.cloudinary.com/console/${cloudName}/media_library`);
    }

    if (mergedConfig.backup?.retention?.enabled && mergedConfig.backup.retention.runAfterBackup) {
      logger.info('\nRunning retention policy...');

      let adapter: IStorageAdapter;
      switch (mergedConfig.storage.provider) {
        case 'local':
          adapter = new LocalStorageAdapter(mergedConfig.storage.local?.path || './backups');
          break;
        case 's3':
        case 'r2':
          if (!mergedConfig.storage.s3?.accessKeyId || !mergedConfig.storage.s3?.secretAccessKey) {
            logger.warn('Skipping retention: Storage credentials missing');
            return;
          }
          adapter = new S3StorageAdapter({
            endpoint: mergedConfig.storage.s3.endpoint,
            bucket: mergedConfig.storage.s3.bucket || '',
            region: mergedConfig.storage.s3.region,
            accessKeyId: mergedConfig.storage.s3.accessKeyId,
            secretAccessKey: mergedConfig.storage.s3.secretAccessKey,
          });
          break;
        case 'cloudinary':
          if (!mergedConfig.storage.cloudinary?.cloudName || !mergedConfig.storage.cloudinary?.apiKey || !mergedConfig.storage.cloudinary?.apiSecret) {
            logger.warn('Skipping retention: Storage credentials missing');
            return;
          }
          adapter = new CloudinaryStorageAdapter({
            cloudName: mergedConfig.storage.cloudinary.cloudName,
            apiKey: mergedConfig.storage.cloudinary.apiKey,
            apiSecret: mergedConfig.storage.cloudinary.apiSecret,
            folder: 'dbdock_backups',
          });
          break;
        default:
          logger.warn(`Skipping retention: Unknown storage provider ${mergedConfig.storage.provider}`);
          return;
      }

      try {
        const retentionStats = await applyRetention(
          adapter,
          mergedConfig.backup.retention,
          mergedConfig.storage.provider,
          false,
        );

        if (retentionStats.deletedBackups > 0) {
          logger.success(`\nRetention cleanup completed:`);
          logger.log(formatRetentionStats(retentionStats));
        } else {
          logger.info('No backups need to be deleted');
        }

        if (retentionStats.errors.length > 0) {
          logger.warn(`\nRetention encountered ${retentionStats.errors.length} error(s)`);
        }
      } catch (err) {
        logger.warn(`Retention policy failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (error) {
    spinner.fail('Backup failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
