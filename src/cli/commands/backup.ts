import ora from 'ora';
import { loadConfig, CLIConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { createBackupStandalone } from '../../standalone/backup-standalone';
import { Logger } from '@nestjs/common';

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
      logger.error('Please provide an encryption key via --encryption-key flag or in config');
      process.exit(1);
    }

    if (mergedConfig.backup?.encryption?.key && mergedConfig.backup.encryption.key.length !== 64) {
      spinner.fail('Invalid encryption key');
      logger.error('Encryption key must be 32 bytes (64 hex characters)');
      process.exit(1);
    }

    spinner.text = 'Starting backup...';

    const result = await createBackupStandalone(mergedConfig);

    spinner.succeed('Backup completed successfully');
    logger.success(`Backup ID: ${result.backupId}`);
    logger.info(`Storage key: ${result.storageKey}`);
    logger.info(`Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`Duration: ${result.duration}ms`);
    if (mergedConfig.backup?.encryption?.enabled) {
      logger.info('Encryption: enabled');
    }
    if (mergedConfig.backup?.compression?.enabled) {
      logger.info(`Compression: enabled (level ${mergedConfig.backup.compression.level || 6})`);
    }
  } catch (error) {
    spinner.fail('Backup failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
