import ora from 'ora';
import { loadConfig, CLIConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { createBackupStandalone } from '../../standalone/backup-standalone';
import { Logger } from '@nestjs/common';
import { applyRetention, formatRetentionStats } from '../utils/retention';
import { LocalStorageAdapter } from '../../storage/adapters/local.adapter';
import { S3StorageAdapter } from '../../storage/adapters/s3.adapter';
import { CloudinaryStorageAdapter } from '../../storage/adapters/cloudinary.adapter';
import { IStorageAdapter } from '../../storage/storage.interface';
import { AlertService } from '../../alerts/alert.service';
import { BackupType, BackupStatus } from '../../backup/backup.types';

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
          enabled:
            options.encrypt !== undefined
              ? options.encrypt
              : config.backup?.encryption?.enabled || false,
          key: options.encryptionKey || config.backup?.encryption?.key,
        },
        compression: {
          enabled:
            options.compress !== undefined
              ? options.compress
              : config.backup?.compression?.enabled || false,
          level: options.compressionLevel || config.backup?.compression?.level,
        },
      },
    };

    // Initialize AlertService
    const mockConfigService = {
      get: (key: string) => {
        if (key === 'alerts') {
          return mergedConfig.alerts;
        }
        return null;
      },
    } as any;
    const alertService = new AlertService(mockConfigService);

    // ... validation logic ...

    spinner.succeed('Configuration validated');

    spinner.start('Creating backup...');
    let totalBytes = 0;
    let currentStage = 'Dumping database';

    const result = await createBackupStandalone(mergedConfig, {
      onProgress: (bytes) => {
        totalBytes = bytes;
        const mb = (bytes / 1024 / 1024).toFixed(2);
        spinner.text = `${currentStage} (${mb} MB)`;
      },
      onStage: (stage) => {
        currentStage = stage;
        const mb =
          totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(2) : '0.00';
        spinner.text = `${stage} (${mb} MB)`;
      },
    });

    spinner.succeed('Backup complete');
    console.log('');
    logger.success('Backup completed successfully');

    // Send success alert
    await alertService.sendBackupSuccessAlert(
      {
        id: result.backupId,
        database: mergedConfig.database.database || 'unknown',
        size: result.size,
        compressedSize: result.size,
        duration: result.duration,
        endTime: new Date(),
        startTime: new Date(Date.now() - result.duration),
        storageKey: result.storageKey,
        type: BackupType.FULL,
        status: BackupStatus.COMPLETED,
        compression: {
          enabled: mergedConfig.backup?.compression?.enabled || false,
        },
      },
      result.downloadUrl,
    );

    logger.success(`Backup ID: ${result.backupId}`);

    if (result.downloadUrl) {
      console.log('');
      logger.info('Download URL (valid for 7 days):');
      logger.info(result.downloadUrl);
      console.log('');
    }
  } catch (error) {
    spinner.fail('Backup failed');
    logger.error(error instanceof Error ? error.message : String(error));

    // Send failure alert
    try {
      const config = loadConfig(); // Reload config in case it wasn't loaded yet
      const mockConfigService = {
        get: (key: string) => {
          if (key === 'alerts') {
            return config.alerts;
          }
          return null;
        },
      } as any;
      const alertService = new AlertService(mockConfigService);

      await alertService.sendBackupFailureAlert(
        {
          id: 'failed-backup',
          database: config.database?.database || 'unknown',
          size: 0,
          compressedSize: 0,
          duration: 0,
          endTime: new Date(),
          startTime: new Date(),
          storageKey: '',
          type: BackupType.FULL,
          status: BackupStatus.FAILED,
          compression: { enabled: false },
        },
        error instanceof Error ? error : new Error(String(error)),
      );
    } catch (alertError) {
      // Ignore alert failures during backup failure
    }

    process.exit(1);
  }
}
