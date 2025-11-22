import inquirer from 'inquirer';
import ora from 'ora';
import { loadConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { LocalStorageAdapter } from '../../storage/adapters/local.adapter';
import { S3StorageAdapter } from '../../storage/adapters/s3.adapter';
import { R2StorageAdapter } from '../../storage/adapters/r2.adapter';
import { CloudinaryStorageAdapter } from '../../storage/adapters/cloudinary.adapter';
import { IStorageAdapter, StorageObject } from '../../storage/storage.interface';
import { spawn } from 'child_process';
import { createBrotliDecompress } from 'zlib';
import { createDecipheriv } from 'crypto';
import { Readable, Transform } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWriteStream, unlinkSync, existsSync } from 'fs';
import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);

export async function restoreCommand(): Promise<void> {
  const spinner = ora('Loading configuration...').start();

  try {
    const config = loadConfig();
    spinner.succeed('Configuration loaded');

    let adapter: IStorageAdapter;

    switch (config.storage.provider) {
      case 'local':
        adapter = new LocalStorageAdapter(config.storage.local?.path || './backups');
        break;

      case 's3':
        if (!config.storage.s3?.accessKeyId || !config.storage.s3?.secretAccessKey) {
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
        if (!config.storage.s3?.accessKeyId || !config.storage.s3?.secretAccessKey) {
          spinner.fail('R2 credentials are required');
          process.exit(1);
        }
        adapter = new S3StorageAdapter({
          endpoint: config.storage.s3.endpoint,
          bucket: config.storage.s3.bucket || '',
          region: config.storage.s3.region || 'auto',
          accessKeyId: config.storage.s3.accessKeyId,
          secretAccessKey: config.storage.s3.secretAccessKey,
        });
        break;

      case 'cloudinary':
        if (!config.storage.cloudinary?.cloudName || !config.storage.cloudinary?.apiKey || !config.storage.cloudinary?.apiSecret) {
          spinner.fail('Cloudinary credentials are required');
          process.exit(1);
        }
        adapter = new CloudinaryStorageAdapter({
          cloudName: config.storage.cloudinary.cloudName,
          apiKey: config.storage.cloudinary.apiKey,
          apiSecret: config.storage.cloudinary.apiSecret,
          folder: config.storage.cloudinary.folder,
        });
        break;

      default:
        spinner.fail(`Unknown storage provider: ${config.storage.provider}`);
        process.exit(1);
    }

    spinner.start('Loading backups...');
    let objects: StorageObject[];
    try {
      objects = await adapter.listObjects({ prefix: 'backup-' });
      objects = objects
        .filter(obj => obj.key.includes('backup-') && obj.key.endsWith('.sql'))
        .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    } catch (err) {
      spinner.fail('Failed to list backups');
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    spinner.succeed(`Found ${objects.length} backup(s)`);

    if (objects.length === 0) {
      logger.error('No backups found');
      logger.info('Run "npx dbdock backup" to create a backup first');
      process.exit(1);
    }

    spinner.start('Analyzing current database...');
    const currentDbStats = await getCurrentDatabaseStats(config);
    spinner.succeed('Database analysis complete');

    logger.info('\n📊 Current Database Statistics:');
    logger.log(`  Database: ${currentDbStats.name}`);
    logger.log(`  Tables: ${currentDbStats.tables}`);
    logger.log(`  Total Size: ${currentDbStats.size}`);
    logger.log(`  Estimated Rows: ${currentDbStats.rows}\n`);

    const { selectedBackup } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedBackup',
        message: 'Select backup to restore:',
        choices: objects.map(obj => ({
          name: `${obj.key} (${(obj.size / 1024 / 1024).toFixed(2)} MB) - ${obj.lastModified.toLocaleString()}`,
          value: obj.key,
        })),
      },
    ]);

    const selectedBackupObj = objects.find(obj => obj.key === selectedBackup);
    if (selectedBackupObj) {
      logger.info('\n📦 Selected Backup Details:');
      logger.log(`  Backup: ${selectedBackup}`);
      logger.log(`  Size: ${(selectedBackupObj.size / 1024 / 1024).toFixed(2)} MB`);
      logger.log(`  Created: ${selectedBackupObj.lastModified.toLocaleString()}`);
      logger.log(`  Age: ${getTimeAgo(selectedBackupObj.lastModified)}\n`);
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'This will overwrite the current database. Continue?',
        default: false,
      },
    ]);

    if (!confirm) {
      logger.warn('Restore cancelled');
      return;
    }

    spinner.start('Restoring backup...');

    const dbConfig = config.database;
    const pgRestoreArgs = [
      '-h', dbConfig.host || 'localhost',
      '-p', String(dbConfig.port || 5432),
      '-U', dbConfig.username || 'postgres',
      '-d', dbConfig.database || 'postgres',
      '-F', 'c',
      '--clean',
      '--no-password',
    ];

    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password,
    };

    spinner.start('Downloading backup...');
    let stream: Readable | Transform;
    let tempFilePath: string | null = null;

    try {
      if (config.storage.provider === 'local') {
        const localAdapter = adapter as LocalStorageAdapter;
        stream = await localAdapter.downloadStream({ key: selectedBackup });
      } else {
        tempFilePath = join(tmpdir(), `dbdock-restore-${Date.now()}.sql`);
        const downloadStream = await adapter.downloadStream({ key: selectedBackup });
        const tempWriteStream = createWriteStream(tempFilePath);

        await new Promise<void>((resolve, reject) => {
          downloadStream.pipe(tempWriteStream);
          downloadStream.on('error', reject);
          tempWriteStream.on('error', reject);
          tempWriteStream.on('finish', resolve);
        });

        const { createReadStream } = await import('fs');
        stream = createReadStream(tempFilePath);
      }
    } catch (err) {
      spinner.fail('Failed to download backup');
      logger.error(err instanceof Error ? err.message : String(err));
      if (tempFilePath && existsSync(tempFilePath)) {
        unlinkSync(tempFilePath);
      }
      process.exit(1);
    }

    stream.on('error', (err) => {
      spinner.fail('Failed to read backup file');
      logger.error(err.message);
      if (tempFilePath && existsSync(tempFilePath)) {
        unlinkSync(tempFilePath);
      }
      process.exit(1);
    });

    if (config.backup?.encryption?.enabled && config.backup.encryption.key) {
      const iv = Buffer.alloc(16);
      const decipher = createDecipheriv(
        'aes-256-cbc',
        Buffer.from(config.backup.encryption.key),
        iv,
      );
      stream = stream.pipe(decipher);
    }

    if (config.backup?.compression?.enabled) {
      const decompressStream = createBrotliDecompress();
      stream = stream.pipe(decompressStream);
    }

    spinner.start('Restoring to database...');
    const pgRestoreProcess = spawn('pg_restore', pgRestoreArgs, { env });

    stream.pipe(pgRestoreProcess.stdin);

    await new Promise<void>((resolve, reject) => {
      let errorOutput = '';

      pgRestoreProcess.on('close', (code) => {
        if (tempFilePath && existsSync(tempFilePath)) {
          unlinkSync(tempFilePath);
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_restore exited with code ${code}${errorOutput ? ': ' + errorOutput : ''}`));
        }
      });
      pgRestoreProcess.on('error', (err) => {
        if (tempFilePath && existsSync(tempFilePath)) {
          unlinkSync(tempFilePath);
        }
        reject(new Error(`Failed to execute pg_restore: ${err.message}`));
      });
      pgRestoreProcess.stderr.on('data', (data) => {
        const message = data.toString();
        if (!message.includes('NOTICE') && !message.includes('WARNING')) {
          errorOutput += message;
          console.error('pg_restore:', message.trim());
        }
      });
    });

    spinner.succeed('Restore completed successfully');
  } catch (error) {
    spinner.fail('Restore failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

interface DatabaseStats {
  name: string;
  tables: number;
  size: string;
  rows: string;
}

async function getCurrentDatabaseStats(config: any): Promise<DatabaseStats> {
  const dbConfig = config.database;

  const queries = [
    `SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'`,
    `SELECT pg_size_pretty(pg_database_size('${dbConfig.database}')) as size`,
    `SELECT sum(n_live_tup) as total_rows FROM pg_stat_user_tables`,
  ];

  const psqlArgs = [
    '-h', dbConfig.host || 'localhost',
    '-p', String(dbConfig.port || 5432),
    '-U', dbConfig.username || 'postgres',
    '-d', dbConfig.database || 'postgres',
    '-t',
    '--no-password',
  ];

  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password,
  };

  const results = await Promise.all(
    queries.map(query =>
      new Promise<string>((resolve, reject) => {
        const psqlProcess = spawn('psql', [...psqlArgs, '-c', query], { env });
        let output = '';
        let errorOutput = '';

        psqlProcess.stdout.on('data', (data) => {
          output += data.toString();
        });

        psqlProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        psqlProcess.on('close', (code) => {
          if (code === 0) {
            resolve(output.trim());
          } else {
            reject(new Error(errorOutput || `Query failed with code ${code}`));
          }
        });

        psqlProcess.on('error', reject);
      })
    )
  );

  return {
    name: dbConfig.database || 'postgres',
    tables: parseInt(results[0]) || 0,
    size: results[1] || 'Unknown',
    rows: results[2] ? parseInt(results[2]).toLocaleString() : '0',
  };
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
