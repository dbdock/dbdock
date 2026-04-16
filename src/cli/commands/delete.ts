import inquirer from 'inquirer';
import ora from 'ora';
import { loadConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { LocalStorageAdapter } from '../../storage/adapters/local.adapter';
import { S3StorageAdapter } from '../../storage/adapters/s3.adapter';
import { R2StorageAdapter } from '../../storage/adapters/r2.adapter';
import { CloudinaryStorageAdapter } from '../../storage/adapters/cloudinary.adapter';
import {
  IStorageAdapter,
  StorageObject,
} from '../../storage/storage.interface';
import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);

interface DeleteCommandOptions {
  all?: boolean;
  key?: string;
}

export async function deleteCommand(
  options: DeleteCommandOptions = {},
): Promise<void> {
  const spinner = ora('Loading configuration...').start();

  try {
    const config = loadConfig();
    spinner.succeed('Configuration loaded');

    let adapter: IStorageAdapter;

    switch (config.storage.provider) {
      case 'local':
        adapter = new LocalStorageAdapter(
          config.storage.local?.path || './backups',
        );
        break;

      case 's3':
        if (
          !config.storage.s3?.accessKeyId ||
          !config.storage.s3?.secretAccessKey
        ) {
          spinner.fail('S3 credentials are required');
          process.exit(1);
        }
        adapter = new S3StorageAdapter({
          endpoint: config.storage.s3.endpoint,
          bucket: config.storage.s3.bucket || '',
          accessKeyId: config.storage.s3.accessKeyId,
          secretAccessKey: config.storage.s3.secretAccessKey,
        });
        break;

      case 'r2':
        if (
          !config.storage.s3?.accessKeyId ||
          !config.storage.s3?.secretAccessKey
        ) {
          spinner.fail('R2 credentials are required');
          process.exit(1);
        }
        if (!config.storage.s3?.endpoint) {
          spinner.fail('R2 endpoint is required');
          process.exit(1);
        }
        {
          const accountIdDelete =
            config.storage.s3.endpoint.match(/https:\/\/([^.]+)/)?.[1];
          if (!accountIdDelete) {
            spinner.fail('Invalid R2 endpoint format');
            process.exit(1);
          }
          adapter = new R2StorageAdapter({
            accountId: accountIdDelete,
            bucket: config.storage.s3.bucket || '',
            accessKeyId: config.storage.s3.accessKeyId,
            secretAccessKey: config.storage.s3.secretAccessKey,
          });
          break;
        }

      case 'cloudinary':
        if (
          !config.storage.cloudinary?.cloudName ||
          !config.storage.cloudinary?.apiKey ||
          !config.storage.cloudinary?.apiSecret
        ) {
          spinner.fail('Cloudinary credentials are required');
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

    spinner.start('Loading backups...');
    let objects: StorageObject[];
    try {
      let prefix: string;
      if (config.storage.provider === 'local') {
        prefix = 'backup-';
      } else if (config.storage.provider === 'cloudinary') {
        prefix = 'backup-';
      } else {
        prefix = 'dbdock_backups/backup-';
      }

      objects = await adapter.listObjects({ prefix });
      objects = objects
        .filter((obj) => obj.key.includes('backup-'))
        .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    } catch (err) {
      spinner.fail('Failed to list backups');
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`\n${errorMessage}\n`);
      process.exit(1);
    }

    spinner.succeed(`Found ${objects.length} backup(s)`);

    if (objects.length === 0) {
      logger.error('\nNo backups found to delete');
      process.exit(1);
    }

    let backupsToDelete: string[] = [];

    if (options.all) {
      const { confirm } = (await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete all ${objects.length} backup(s)? This action cannot be undone.`,
          default: false,
        },
      ])) as { confirm: boolean };

      if (!confirm) {
        logger.warn('Delete cancelled');
        return;
      }

      backupsToDelete = objects.map((obj) => obj.key);
    } else if (options.key) {
      const backup = objects.find(
        (obj) => obj.key === options.key || obj.key.includes(options.key!),
      );
      if (!backup) {
        logger.error(`\nBackup not found: ${options.key}`);
        process.exit(1);
      }

      const { confirm } = (await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete backup "${backup.key}"? This action cannot be undone.`,
          default: false,
        },
      ])) as { confirm: boolean };

      if (!confirm) {
        logger.warn('Delete cancelled');
        return;
      }

      backupsToDelete = [backup.key];
    } else {
      const { action } = (await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Delete a specific backup', value: 'specific' },
            { name: 'Delete multiple backups', value: 'multiple' },
            { name: 'Delete all backups', value: 'all' },
          ],
        },
      ])) as { action: 'specific' | 'multiple' | 'all' };

      if (action === 'all') {
        const { confirm } = (await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Delete all ${objects.length} backup(s)? This action cannot be undone.`,
            default: false,
          },
        ])) as { confirm: boolean };

        if (!confirm) {
          logger.warn('Delete cancelled');
          return;
        }

        backupsToDelete = objects.map((obj) => obj.key);
      } else if (action === 'specific') {
        const { selectedBackup } = (await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedBackup',
            message: 'Select backup to delete:',
            choices: objects.map((obj) => ({
              name: `${obj.key} (${(obj.size / 1024 / 1024).toFixed(2)} MB) - ${obj.lastModified.toLocaleString()}`,
              value: obj.key,
            })),
          },
        ])) as { selectedBackup: string };

        const { confirm } = (await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Delete backup "${selectedBackup}"? This action cannot be undone.`,
            default: false,
          },
        ])) as { confirm: boolean };

        if (!confirm) {
          logger.warn('Delete cancelled');
          return;
        }

        backupsToDelete = [selectedBackup];
      } else {
        const { selectedBackups } = (await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedBackups',
            message: 'Select backups to delete (use space to select):',
            choices: objects.map((obj) => ({
              name: `${obj.key} (${(obj.size / 1024 / 1024).toFixed(2)} MB) - ${obj.lastModified.toLocaleString()}`,
              value: obj.key,
            })),
          },
        ])) as { selectedBackups: string[] };

        if (selectedBackups.length === 0) {
          logger.warn('No backups selected');
          return;
        }

        const { confirm } = (await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Delete ${selectedBackups.length} backup(s)? This action cannot be undone.`,
            default: false,
          },
        ])) as { confirm: boolean };

        if (!confirm) {
          logger.warn('Delete cancelled');
          return;
        }

        backupsToDelete = selectedBackups;
      }
    }

    spinner.start(`Deleting ${backupsToDelete.length} backup(s)...`);

    let deletedCount = 0;
    let failedCount = 0;

    for (const key of backupsToDelete) {
      try {
        await adapter.deleteObject({ key });
        deletedCount++;
      } catch (err) {
        failedCount++;
        logger.error(
          `\nFailed to delete ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (failedCount === 0) {
      spinner.succeed(`Successfully deleted ${deletedCount} backup(s)`);
    } else {
      spinner.warn(`Deleted ${deletedCount} backup(s), ${failedCount} failed`);
    }
  } catch (error) {
    spinner.fail('Delete operation failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
