import inquirer from 'inquirer';
import ora from 'ora';
import { loadConfig, CLIConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { LocalStorageAdapter } from '../../storage/adapters/local.adapter';
import { S3StorageAdapter } from '../../storage/adapters/s3.adapter';
import { R2StorageAdapter } from '../../storage/adapters/r2.adapter';
import { CloudinaryStorageAdapter } from '../../storage/adapters/cloudinary.adapter';
import {
  IStorageAdapter,
  StorageObject,
} from '../../storage/storage.interface';
import { spawn } from 'child_process';
import { createBrotliDecompress } from 'zlib';
import { createDecipheriv } from 'crypto';
import { Readable, Transform } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWriteStream, unlinkSync, existsSync } from 'fs';
import { Logger } from '@nestjs/common';
import { MultiStepProgress } from '../utils/progress';

Logger.overrideLogger(false);

interface FilterOptionAnswer {
  filterOption: 'recent' | 'date' | 'search' | 'all';
}

interface DateFilterAnswer {
  dateFilter: number | 'custom';
}

interface StartDateAnswer {
  startDate: string;
}
interface SearchTermAnswer {
  searchTerm: string;
}

interface SelectedBackupAnswer {
  selected: string;
}

interface ConfirmAnswer {
  confirm: boolean;
}

export async function restoreCommand(): Promise<void> {
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
          config.storage.s3.endpoint.match(/https:\/\/([^.]+)/)?.[1];
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
        .filter((obj) => {
          const key = obj.key.toLowerCase();
          return (
            key.includes('backup-') &&
            (key.endsWith('.sql') ||
              key.endsWith('.dump') ||
              key.endsWith('.tar') ||
              key.endsWith('.dir') ||
              config.storage.provider === 'cloudinary')
          );
        })
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
        logger.log(`  • Files are named: backup-*.dump or backup-*.sql`);
        logger.log(`  • You have read permissions on the directory`);
      } else if (config.storage.provider === 's3') {
        const bucket = config.storage.s3?.bucket || '';
        logger.info('\nPlease verify:');
        logger.log(`  • Backups exist in S3 bucket: ${bucket}`);
        logger.log(`  • Files are in folder: dbdock_backups/`);
        logger.log(`  • Files are named: backup-*.dump or backup-*.sql`);
        logger.log(`  • Your AWS credentials have s3:ListBucket permission`);
      } else if (config.storage.provider === 'r2') {
        const bucket = config.storage.s3?.bucket || '';
        logger.info('\nPlease verify:');
        logger.log(`  • Backups exist in R2 bucket: ${bucket}`);
        logger.log(`  • Files are in folder: dbdock_backups/`);
        logger.log(`  • Files are named: backup-*.dump or backup-*.sql`);
        logger.log(`  • Your R2 credentials have read permissions`);
      } else if (config.storage.provider === 'cloudinary') {
        const cloudName = config.storage.cloudinary?.cloudName || '';
        logger.info('\nPlease verify:');
        logger.log(`  • Backups exist in Cloudinary cloud: ${cloudName}`);
        logger.log(`  • Files are in folder: dbdock_backups`);
        logger.log(`  • Files are named: backup-*.dump or backup-*.sql`);
        logger.log(`  • Your API credentials are correct`);
        logger.log(
          `  • Check: https://console.cloudinary.com/console/${cloudName}/media_library/folders/dbdock_backups`,
        );
      }

      logger.info('\nTo create a backup, run:');
      logger.log('  npx dbdock backup');
      process.exit(1);
    }

    spinner.start('Analyzing current database...');
    const currentDbStats = await getCurrentDatabaseStats(config);
    spinner.succeed('Database analysis complete');

    logger.info('\nCurrent Database Statistics:');
    logger.log(`  Database: ${currentDbStats.name}`);
    logger.log(`  Tables: ${currentDbStats.tables}`);
    logger.log(`  Total Size: ${currentDbStats.size}`);
    logger.log(`  Estimated Rows: ${currentDbStats.rows}\n`);

    let selectedBackup: string;

    if (objects.length > 20) {
      logger.info(
        `Found ${objects.length} backups. Let's filter them to find the right one.\n`,
      );

      const { filterOption } = (await inquirer.prompt([
        {
          type: 'list',
          name: 'filterOption',
          message: 'How would you like to find your backup?',
          choices: [
            { name: 'Show most recent backups (last 10)', value: 'recent' },
            { name: 'Filter by date range', value: 'date' },
            { name: 'Search by keyword/ID', value: 'search' },
            {
              name: 'Show all backups (not recommended for many backups)',
              value: 'all',
            },
          ],
        },
      ])) as FilterOptionAnswer;

      let filteredObjects = objects;

      if (filterOption === 'recent') {
        filteredObjects = objects.slice(0, 10);
        logger.info(`\nShowing the 10 most recent backups:\n`);
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
              { name: 'Custom date range', value: 'custom' },
            ],
          },
        ])) as DateFilterAnswer;

        if (dateFilter === 'custom') {
          const { startDate } = (await inquirer.prompt([
            {
              type: 'input',
              name: 'startDate',
              message: 'Enter start date (YYYY-MM-DD):',
              validate: (input: string) => {
                const date = new Date(input);
                return !isNaN(date.getTime()) || 'Please enter a valid date';
              },
            },
          ])) as StartDateAnswer;

          const cutoffDate = new Date(startDate);
          filteredObjects = objects.filter(
            (obj) => obj.lastModified >= cutoffDate,
          );
        } else if (typeof dateFilter === 'number') {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - dateFilter);
          filteredObjects = objects.filter(
            (obj) => obj.lastModified >= cutoffDate,
          );
        }

        logger.info(
          `\nFound ${filteredObjects.length} backup(s) in this time range:\n`,
        );
      } else if (filterOption === 'search') {
        const { searchTerm } = (await inquirer.prompt([
          {
            type: 'input',
            name: 'searchTerm',
            message: 'Enter search term (backup ID, date, etc.):',
          },
        ])) as SearchTermAnswer;

        filteredObjects = objects.filter((obj) =>
          obj.key.toLowerCase().includes(searchTerm.toLowerCase()),
        );

        logger.info(
          `\nFound ${filteredObjects.length} backup(s) matching "${searchTerm}":\n`,
        );
      }

      if (filteredObjects.length === 0) {
        logger.error('No backups found matching your criteria');
        process.exit(1);
      }

      const { selected } = (await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: `Select backup to restore (${filteredObjects.length} shown):`,
          pageSize: 15,
          choices: filteredObjects.map((obj) => ({
            name: `${obj.key.replace('dbdock_backups/', '')} (${(obj.size / 1024 / 1024).toFixed(2)} MB) - ${obj.lastModified.toLocaleString()} - ${getTimeAgo(obj.lastModified)}`,
            value: obj.key,
          })),
        },
      ])) as SelectedBackupAnswer;

      selectedBackup = selected;
    } else {
      const { selected } = (await inquirer.prompt([
        {
          type: 'list',
          name: 'selected',
          message: 'Select backup to restore:',
          pageSize: 15,
          choices: objects.map((obj) => ({
            name: `${obj.key.replace('dbdock_backups/', '')} (${(obj.size / 1024 / 1024).toFixed(2)} MB) - ${obj.lastModified.toLocaleString()} - ${getTimeAgo(obj.lastModified)}`,
            value: obj.key,
          })),
        },
      ])) as SelectedBackupAnswer;

      selectedBackup = selected;
    }

interface RestoreTargetAnswer {
  target: 'current' | 'new';
}

interface MigrationDetailsAnswer {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

// ... existing interfaces ...

    const selectedBackupObj = objects.find((obj) => obj.key === selectedBackup);
    if (selectedBackupObj) {
      logger.info('\nSelected Backup Details:');
      logger.log(`  Backup: ${selectedBackup}`);
      logger.log(
        `  Size: ${(selectedBackupObj.size / 1024 / 1024).toFixed(2)} MB`,
      );
      logger.log(
        `  Created: ${selectedBackupObj.lastModified.toLocaleString()}`,
      );
      logger.log(`  Age: ${getTimeAgo(selectedBackupObj.lastModified)}\n`);
    }

    const { target } = (await inquirer.prompt([
      {
        type: 'list',
        name: 'target',
        message: 'Where would you like to restore this backup?',
        choices: [
          { name: 'Current Database (Overwrite)', value: 'current' },
          { name: 'New Database Instance (Migrate)', value: 'new' },
        ],
        default: 'current',
      },
    ])) as RestoreTargetAnswer;

    let targetDbConfig = config.database;

    if (target === 'new') {
      const migrationDetails = (await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: 'Target Host:',
          default: 'localhost',
        },
        {
          type: 'number',
          name: 'port',
          message: 'Target Port:',
          default: 5432,
        },
        {
          type: 'input',
          name: 'username',
          message: 'Target Username:',
          default: 'postgres',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Target Password:',
        },
        {
          type: 'input',
          name: 'database',
          message: 'Target Database Name:',
        },
      ])) as MigrationDetailsAnswer;

      targetDbConfig = {
        type: 'postgres',
        ...migrationDetails,
      };
    }

    const { confirm } = (await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: target === 'new' 
          ? `This will restore to ${targetDbConfig.host}:${targetDbConfig.port}/${targetDbConfig.database}. Continue?`
          : 'This will overwrite the current database. Continue?',
        default: false,
      },
    ])) as ConfirmAnswer;

    if (!confirm) {
      logger.warn('Restore cancelled');
      return;
    }

    const restoreSteps = new MultiStepProgress([
      'Downloading backup',
      'Decrypting data',
      'Decompressing data',
      'Restoring to database',
    ]);

    restoreSteps.start();

    const pgRestoreArgs = [
      '-h',
      targetDbConfig.host || 'localhost',
      '-p',
      String(targetDbConfig.port || 5432),
      '-U',
      targetDbConfig.username || 'postgres',
      '-d',
      targetDbConfig.database || 'postgres',
      '-F',
      'c',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--no-password',
    ];

    const env = {
      ...process.env,
      PGPASSWORD: targetDbConfig.password,
    };

    let stream: Readable | Transform;
    let tempFilePath: string | null = null;

    try {
      if (config.storage.provider === 'local') {
        const localAdapter = adapter as LocalStorageAdapter;
        stream = await localAdapter.downloadStream({ key: selectedBackup });
      } else {
        tempFilePath = join(tmpdir(), `dbdock-restore-${Date.now()}.sql`);
        const downloadStream = await adapter.downloadStream({
          key: selectedBackup,
        });
        const tempWriteStream = createWriteStream(tempFilePath);

        let downloadedBytes = 0;
        downloadStream.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          const mb = (downloadedBytes / 1024 / 1024).toFixed(2);
          restoreSteps.nextStep(`${mb} MB downloaded`);
        });

        await new Promise<void>((resolve, reject) => {
          downloadStream.pipe(tempWriteStream);
          downloadStream.on('error', reject);
          tempWriteStream.on('error', reject);
          tempWriteStream.on('finish', resolve);
        });

        const { createReadStream } = await import('fs');
        stream = createReadStream(tempFilePath);
      }

      restoreSteps.nextStep();
    } catch (err) {
      restoreSteps.fail(err instanceof Error ? err.message : String(err));
      if (tempFilePath && existsSync(tempFilePath)) {
        unlinkSync(tempFilePath);
      }
      process.exit(1);
    }

    stream.on('error', (err) => {
      restoreSteps.fail(`Failed to read backup file: ${err.message}`);
      if (tempFilePath && existsSync(tempFilePath)) {
        unlinkSync(tempFilePath);
      }
      process.exit(1);
    });

    if (config.backup?.encryption?.enabled && config.backup.encryption.key) {
      const keyBuffer = Buffer.from(config.backup.encryption.key, 'hex');

      if (keyBuffer.length !== 32) {
        restoreSteps.fail(
          `Invalid encryption key length: ${keyBuffer.length} bytes (expected 32 bytes)`,
        );
        logger.error(
          `\nYour key: "${config.backup.encryption.key}" (${config.backup.encryption.key.length} characters)\n\n` +
            `Please fix:\n` +
            `  • Encryption key must be exactly 64 hexadecimal characters (32 bytes)\n` +
            `  • Generate a valid key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n` +
            `  • Update the "backup.encryption.key" in your dbdock.config.json`,
        );
        if (tempFilePath && existsSync(tempFilePath)) {
          unlinkSync(tempFilePath);
        }
        process.exit(1);
      }

      const iv = Buffer.alloc(16);
      const decipher = createDecipheriv('aes-256-cbc', keyBuffer, iv);
      stream = stream.pipe(decipher);
      restoreSteps.nextStep();
    } else {
      restoreSteps.nextStep();
    }

    if (config.backup?.compression?.enabled) {
      const decompressStream = createBrotliDecompress();
      stream = stream.pipe(decompressStream);
      restoreSteps.nextStep();
    } else {
      restoreSteps.nextStep();
    }
    const pgRestoreProcess = spawn('pg_restore', pgRestoreArgs, { env });

    stream.pipe(pgRestoreProcess.stdin);

    const ignoredPatterns = [
      'NOTICE',
      'WARNING',
      'transaction_timeout',
      'errors ignored on restore',
      'unrecognized configuration parameter',
      'already exists',
      'does not exist',
      'no privileges could be revoked',
      'no privileges were granted',
      'role .* does not exist',
      'extension .* already exists',
      'schema .* already exists',
      'procedural language .* already exists',
    ];

    const shouldIgnoreError = (message: string): boolean => {
      return ignoredPatterns.some((pattern) =>
        message.toLowerCase().includes(pattern.toLowerCase()),
      );
    };

    await new Promise<void>((resolve, reject) => {
      let errorOutput = '';
      let hasWarnings = false;

      pgRestoreProcess.on('close', (code) => {
        if (tempFilePath && existsSync(tempFilePath)) {
          unlinkSync(tempFilePath);
        }

        if (code === 0 || (code === 1 && !errorOutput && hasWarnings)) {
          resolve();
        } else if (code === 1 && errorOutput) {
          const friendlyError = parsePgRestoreError(errorOutput);
          reject(new Error(friendlyError));
        } else if (code !== 0) {
          reject(
            new Error(
              `pg_restore exited with code ${code}${errorOutput ? ': ' + errorOutput : ''}`,
            ),
          );
        }
      });
      pgRestoreProcess.on('error', (err) => {
        if (tempFilePath && existsSync(tempFilePath)) {
          unlinkSync(tempFilePath);
        }
        reject(new Error(`Failed to execute pg_restore: ${err.message}`));
      });
      pgRestoreProcess.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        if (shouldIgnoreError(message)) {
          hasWarnings = true;
        } else if (message.trim()) {
          errorOutput += message;
        }
      });
    });

    restoreSteps.complete();
    logger.success('Restore completed successfully');

    if (target === 'new') {
      logger.info('\n🚀 Migration Successful! New Database Details:');
      logger.log('────────────────────────────────────────────────────────');
      logger.log(`  Host:      ${targetDbConfig.host}`);
      logger.log(`  Port:      ${targetDbConfig.port}`);
      logger.log(`  Database:  ${targetDbConfig.database}`);
      logger.log(`  Username:  ${targetDbConfig.username}`);
      logger.log(`  Password:  ********`);
      logger.log('────────────────────────────────────────────────────────');
      logger.info('You can now connect to your new database instance.\n');
    }
  } catch (error) {
    spinner.stop();
    logger.error(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}



interface DatabaseStats {
  name: string;
  tables: number;
  size: string;
  rows: string;
}

async function getCurrentDatabaseStats(
  config: CLIConfig,
): Promise<DatabaseStats> {
  const dbConfig = config.database;

  const queries = [
    `SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'`,
    `SELECT pg_size_pretty(pg_database_size('${dbConfig.database}')) as size`,
    `SELECT sum(n_live_tup) as total_rows FROM pg_stat_user_tables`,
  ];

  const psqlArgs = [
    '-h',
    dbConfig.host || 'localhost',
    '-p',
    String(dbConfig.port || 5432),
    '-U',
    dbConfig.username || 'postgres',
    '-d',
    dbConfig.database || 'postgres',
    '-t',
    '--no-password',
  ];

  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password,
  };

  const results = await Promise.all(
    queries.map(
      (query) =>
        new Promise<string>((resolve, reject) => {
          const psqlProcess = spawn('psql', [...psqlArgs, '-c', query], {
            env,
          });
          let output = '';
          let errorOutput = '';

          psqlProcess.stdout.on('data', (data: Buffer) => {
            output += data.toString();
          });

          psqlProcess.stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();
          });

          psqlProcess.on('close', (code) => {
            if (code === 0) {
              resolve(output.trim());
            } else {
              reject(
                new Error(errorOutput || `Query failed with code ${code}`),
              );
            }
          });

          psqlProcess.on('error', reject);
        }),
    ),
  );

  return {
    name: dbConfig.database || 'postgres',
    tables: parseInt(results[0]) || 0,
    size: results[1] || 'Unknown',
    rows: results[2] ? parseInt(results[2]).toLocaleString() : '0',
  };
}

function parsePgRestoreError(errorOutput: string): string {
  const lowerError = errorOutput.toLowerCase();

  if (lowerError.includes('authentication failed')) {
    return (
      'Database authentication failed\n\n' +
      'Please verify:\n' +
      '  • Database password is correct in dbdock.config.json\n' +
      '  • Database user has necessary permissions\n' +
      '  • Database host and port are accessible'
    );
  }

  if (lowerError.includes('connection refused') || lowerError.includes('could not connect')) {
    return (
      'Failed to connect to database\n\n' +
      'Please verify:\n' +
      '  • Database server is running\n' +
      '  • Host and port are correct in dbdock.config.json\n' +
      '  • Firewall allows connection to database port\n' +
      '  • Database accepts connections from your IP'
    );
  }

  if (lowerError.includes('permission denied')) {
    return (
      'Database permission denied\n\n' +
      'Please verify:\n' +
      '  • Database user has CREATE/DROP privileges\n' +
      '  • User has permission to restore to this database\n' +
      '  • Try using a superuser account for restore'
    );
  }

  if (lowerError.includes('database') && lowerError.includes('does not exist')) {
    return (
      'Target database does not exist\n\n' +
      'Please:\n' +
      '  • Create the database first, or\n' +
      '  • Update database name in dbdock.config.json'
    );
  }

  if (lowerError.includes('disk full') || lowerError.includes('no space left')) {
    return (
      'Insufficient disk space\n\n' +
      'Please:\n' +
      '  • Free up disk space on database server\n' +
      '  • Check available storage before restoring'
    );
  }

  if (lowerError.includes('corrupted') || lowerError.includes('invalid backup')) {
    return (
      'Backup file appears to be corrupted\n\n' +
      'Please:\n' +
      '  • Try a different backup file\n' +
      '  • Verify backup was created successfully\n' +
      '  • Check encryption key matches if encryption is enabled'
    );
  }

  return `Database restore error:\n\n${errorOutput.trim()}\n\nIf you need help, please check the documentation or report this issue.`;
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
