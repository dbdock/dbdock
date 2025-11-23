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

interface ListCommandOptions {
  recent?: number;
  search?: string;
  days?: number;
  limit?: number;
}

export async function listCommand(
  options: ListCommandOptions = {},
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

      case 'r2': {
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
        const accountId =
          config.storage.s3.endpoint.match(/https:\/\/([^.]+)/)?.[1] || '';
        if (!accountId) {
          spinner.fail('Invalid R2 endpoint format');
          process.exit(1);
        }
        adapter = new R2StorageAdapter({
          accountId,
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

      if (config.storage.provider === 's3') {
        logger.info('Common S3 issues:');
        logger.log('  • Verify AWS credentials are correct');
        logger.log('  • Ensure IAM user has s3:ListBucket permission');
        logger.log('  • Check bucket name and region are correct');
        logger.log('  • Verify bucket exists and is accessible');
      } else if (config.storage.provider === 'r2') {
        logger.info('Common R2 issues:');
        logger.log('  • Verify R2 API token is correct');
        logger.log('  • Ensure endpoint URL is correct');
        logger.log('  • Check bucket name is correct');
        logger.log('  • Verify bucket exists and is accessible');
      } else if (config.storage.provider === 'cloudinary') {
        logger.info('Common Cloudinary issues:');
        logger.log('  • Verify cloud name, API key, and secret are correct');
        logger.log('  • Check your Cloudinary account is active');
        logger.log('  • Ensure API credentials have media library access');
      } else if (config.storage.provider === 'local') {
        const localPath = config.storage.local?.path || './backups';
        logger.info('Common local storage issues:');
        logger.log(`  • Verify directory exists: ${localPath}`);
        logger.log('  • Check you have read permissions');
        logger.log('  • Ensure path is correct in dbdock.config.json');
      }

      logger.info('\nTo test your configuration, run:');
      logger.log('  npx dbdock test');
      process.exit(1);
    }

    spinner.succeed(`Found ${objects.length} backup(s)`);

    if (objects.length === 0) {
      logger.error('\nNo backups found');

      if (config.storage.provider === 'local') {
        const localPath = config.storage.local?.path || './backups';
        logger.info('\nPlease verify:');
        logger.log(`  • Backup files exist in: ${localPath}`);
        logger.log(`  • Files are named: backup-*.sql`);
        logger.log(`  • You have read permissions on the directory`);
      } else if (config.storage.provider === 's3') {
        const bucket = config.storage.s3?.bucket || '';
        logger.info('\nPlease verify:');
        logger.log(`  • Backups exist in S3 bucket: ${bucket}`);
        logger.log(`  • Files are in folder: dbdock_backups/`);
        logger.log(`  • Files are named: backup-*.sql`);
        logger.log(`  • Your AWS credentials have s3:ListBucket permission`);
      } else if (config.storage.provider === 'r2') {
        const bucket = config.storage.s3?.bucket || '';
        logger.info('\nPlease verify:');
        logger.log(`  • Backups exist in R2 bucket: ${bucket}`);
        logger.log(`  • Files are in folder: dbdock_backups/`);
        logger.log(`  • Files are named: backup-*.sql`);
        logger.log(`  • Your R2 credentials have read permissions`);
      } else if (config.storage.provider === 'cloudinary') {
        const cloudName = config.storage.cloudinary?.cloudName || '';
        logger.info('\nPlease verify:');
        logger.log(`  • Backups exist in Cloudinary cloud: ${cloudName}`);
        logger.log(`  • Files are in folder: dbdock_backups`);
        logger.log(`  • Files are named: backup-*.sql`);
        logger.log(`  • Your API credentials are correct`);
        logger.log(
          `  • Check: https://console.cloudinary.com/console/${cloudName}/media_library/folders/dbdock_backups`,
        );
      }

      logger.info('\nTo create a backup, run:');
      logger.log('  npx dbdock backup');
      process.exit(1);
    }

    let filteredObjects = objects;
    let filterDescription = '';

    if (options.recent) {
      filteredObjects = objects.slice(0, options.recent);
      filterDescription = ` (showing ${options.recent} most recent)`;
    } else if (options.search) {
      filteredObjects = objects.filter((obj) =>
        obj.key.toLowerCase().includes(options.search!.toLowerCase()),
      );
      filterDescription = ` (filtered by "${options.search}")`;
    } else if (options.days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.days);
      filteredObjects = objects.filter((obj) => obj.lastModified >= cutoffDate);
      filterDescription = ` (last ${options.days} days)`;
    } else if (objects.length > 50) {
      logger.info(
        `Found ${objects.length} backups. Would you like to filter them?\n`,
      );

      const { filterOption } = (await inquirer.prompt([
        {
          type: 'list',
          name: 'filterOption',
          message: 'Select view:',
          choices: [
            { name: 'Show most recent backups (last 20)', value: 'recent' },
            { name: 'Filter by date range', value: 'date' },
            { name: 'Search by keyword/ID', value: 'search' },
            { name: 'Show all backups', value: 'all' },
          ],
        },
      ])) as { filterOption: string };

      if (filterOption === 'recent') {
        filteredObjects = objects.slice(0, 20);
        filterDescription = ' (20 most recent)';
      } else if (filterOption === 'date') {
        const { dateFilter } = (await inquirer.prompt([
          {
            type: 'list',
            name: 'dateFilter',
            message: 'Select time range:',
            choices: [
              { name: 'Last 24 hours', value: 1 },
              { name: 'Last 7 days', value: 7 },
              { name: 'Last 30 days', value: 30 },
              { name: 'Last 90 days', value: 90 },
            ],
          },
        ])) as { dateFilter: number };

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - dateFilter);
        filteredObjects = objects.filter(
          (obj) => obj.lastModified >= cutoffDate,
        );
        filterDescription = ` (last ${dateFilter} days)`;
      } else if (filterOption === 'search') {
        const { searchTerm } = (await inquirer.prompt([
          {
            type: 'input',
            name: 'searchTerm',
            message: 'Enter search term:',
          },
        ])) as { searchTerm: string };

        filteredObjects = objects.filter((obj) =>
          obj.key.toLowerCase().includes(searchTerm.toLowerCase()),
        );
        filterDescription = ` (filtered by "${searchTerm}")`;
      }
    }

    if (options.limit && filteredObjects.length > options.limit) {
      filteredObjects = filteredObjects.slice(0, options.limit);
      filterDescription += ` (limited to ${options.limit})`;
    }

    logger.info(`\nBackups${filterDescription}:`);
    logger.info('─'.repeat(80));

    if (filteredObjects.length === 0) {
      logger.warn('\nNo backups match your criteria');
      logger.info(`\nTotal available backups: ${objects.length}`);
      logger.info(
        `Try adjusting your filters or use --search, --recent, or --days flags\n`,
      );
      return;
    }

    filteredObjects.forEach((obj, index) => {
      const displayName = obj.key.replace('dbdock_backups/', '');
      logger.log(`\n${index + 1}. ${displayName}`);
      logger.log(`   Size: ${(obj.size / 1024 / 1024).toFixed(2)} MB`);
      logger.log(`   Created: ${obj.lastModified.toLocaleString()}`);
      logger.log(`   Age: ${getTimeAgo(obj.lastModified)}`);
    });
    logger.info('\n' + '─'.repeat(80));
    logger.info(
      `\nShowing: ${filteredObjects.length} of ${objects.length} total backups`,
    );
    logger.info(
      `Total size: ${(objects.reduce((sum, obj) => sum + obj.size, 0) / 1024 / 1024).toFixed(2)} MB\n`,
    );
  } catch (error) {
    spinner.fail('Operation failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else {
    return 'Just now';
  }
}
