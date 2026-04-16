import inquirer from 'inquirer';
import ora from 'ora';
import { loadConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { LocalStorageAdapter } from '../../storage/adapters/local.adapter';
import { S3StorageAdapter } from '../../storage/adapters/s3.adapter';
import { CloudinaryStorageAdapter } from '../../storage/adapters/cloudinary.adapter';
import { IStorageAdapter } from '../../storage/storage.interface';
import { Logger } from '@nestjs/common';
import {
  applyRetention,
  evaluateRetention,
  formatRetentionStats,
  getDefaultRetentionConfig,
} from '../utils/retention';

Logger.overrideLogger(false);

interface CleanupOptions {
  dryRun?: boolean;
  force?: boolean;
}

export async function cleanupCommand(
  options: CleanupOptions = {},
): Promise<void> {
  const spinner = ora('Loading configuration...').start();

  try {
    const config = loadConfig();
    spinner.succeed('Configuration loaded');

    if (!config.backup?.retention) {
      logger.warn('\nNo retention policy configured.');
      logger.info('Using default retention policy:');
      const defaultConfig = getDefaultRetentionConfig();
      logger.log(`  - Max backups: ${defaultConfig.maxBackups}`);
      logger.log(`  - Max age: ${defaultConfig.maxAgeDays} days`);
      logger.log(`  - Min backups: ${defaultConfig.minBackups}\n`);

      const { proceed } = (await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Use default retention policy?',
          default: false,
        },
      ])) as { proceed: boolean };

      if (!proceed) {
        logger.info('Cleanup cancelled');
        return;
      }

      config.backup = {
        ...config.backup,
        retention: defaultConfig,
      };
    }

    const retentionConfig = config.backup.retention!;

    if (!retentionConfig.enabled) {
      logger.error('Retention policy is disabled in config');
      logger.info('Set "backup.retention.enabled": true in dbdock.config.json');
      process.exit(1);
    }

    let adapter: IStorageAdapter;
    spinner.start('Connecting to storage...');

    switch (config.storage.provider) {
      case 'local':
        adapter = new LocalStorageAdapter(
          config.storage.local?.path || './backups',
        );
        break;
      case 's3':
      case 'r2':
        if (
          !config.storage.s3?.accessKeyId ||
          !config.storage.s3?.secretAccessKey
        ) {
          spinner.fail('Storage credentials required');
          process.exit(1);
        }
        adapter = new S3StorageAdapter({
          endpoint: config.storage.s3.endpoint,
          bucket: config.storage.s3.bucket || '',
          region: config.storage.s3.region,
          accessKeyId: config.storage.s3.accessKeyId,
          secretAccessKey: config.storage.s3.secretAccessKey,
        });
        break;
      case 'cloudinary':
        if (
          !config.storage.cloudinary?.cloudName ||
          !config.storage.cloudinary?.apiKey ||
          !config.storage.cloudinary?.apiSecret
        ) {
          spinner.fail('Cloudinary credentials required');
          process.exit(1);
        }
        adapter = new CloudinaryStorageAdapter({
          cloudName: config.storage.cloudinary.cloudName,
          apiKey: config.storage.cloudinary.apiKey,
          apiSecret: config.storage.cloudinary.apiSecret,
          folder: 'dbdock_backups',
        });
        break;
      default:
        spinner.fail(`Unknown storage provider: ${config.storage.provider}`);
        process.exit(1);
    }

    spinner.succeed('Connected to storage');

    spinner.start('Evaluating retention policy...');
    const backupInfo = await evaluateRetention(
      adapter,
      retentionConfig,
      config.storage.provider,
    );

    const toDelete = backupInfo.filter((b) => b.shouldDelete);
    const toKeep = backupInfo.filter((b) => !b.shouldDelete);

    spinner.succeed('Evaluation complete');

    logger.info('\nRetention Policy:');
    logger.log(`  Max backups: ${retentionConfig.maxBackups || 'unlimited'}`);
    logger.log(`  Max age: ${retentionConfig.maxAgeDays || 'unlimited'} days`);
    logger.log(`  Min backups: ${retentionConfig.minBackups || 0}`);

    logger.info('\nCurrent State:');
    logger.log(`  Total backups: ${backupInfo.length}`);
    logger.log(`  Will keep: ${toKeep.length}`);
    logger.log(`  Will delete: ${toDelete.length}`);

    if (toDelete.length > 0) {
      const spaceToReclaim = toDelete.reduce((sum, b) => sum + b.size, 0);
      const mb = (spaceToReclaim / 1024 / 1024).toFixed(2);
      const gb = (spaceToReclaim / 1024 / 1024 / 1024).toFixed(2);
      logger.log(
        `  Space to reclaim: ${parseFloat(gb) >= 1 ? `${gb} GB` : `${mb} MB`}`,
      );

      if (!options.dryRun && toDelete.length <= 10) {
        logger.info('\nBackups to delete:');
        toDelete.forEach((backup, index) => {
          const displayName = backup.key.replace('dbdock_backups/', '');
          logger.log(`  ${index + 1}. ${displayName}`);
          logger.log(`     Reason: ${backup.reason}`);
          logger.log(
            `     Age: ${Math.floor((Date.now() - backup.lastModified.getTime()) / (1000 * 60 * 60 * 24))} days`,
          );
        });
      }
    } else {
      logger.success('\nNo backups need to be deleted!');
      logger.info('All backups are within retention policy.');
      return;
    }

    if (options.dryRun) {
      logger.info('\n[DRY RUN] No backups were deleted');
      logger.info('Run without --dry-run to actually delete backups');
      return;
    }

    if (!options.force) {
      console.log('');
      const { confirm } = (await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete ${toDelete.length} backup(s)?`,
          default: false,
        },
      ])) as { confirm: boolean };

      if (!confirm) {
        logger.warn('Cleanup cancelled');
        return;
      }
    }

    spinner.start(`Deleting ${toDelete.length} backup(s)...`);

    const stats = await applyRetention(
      adapter,
      retentionConfig,
      config.storage.provider,
      false,
    );

    spinner.succeed('Cleanup completed');

    logger.success('\nResults:');
    logger.log(formatRetentionStats(stats));

    if (stats.errors.length > 0) {
      logger.warn(`\nEncountered ${stats.errors.length} error(s):`);
      stats.errors.forEach((error, index) => {
        logger.log(`  ${index + 1}. ${error}`);
      });
    }
  } catch (error) {
    spinner.fail('Cleanup failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
