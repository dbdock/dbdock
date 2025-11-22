import ora from 'ora';
import { loadConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);

export async function testCommand(): Promise<void> {
  logger.info('Testing DBDock configuration...\n');

  const spinner = ora('Loading configuration...').start();

  try {
    const config = loadConfig();
    spinner.succeed('Configuration loaded');

    spinner.start('Testing database connection...');
    await testDatabaseConnection(config);
    spinner.succeed('Database connection successful');

    spinner.start('Testing storage configuration...');
    await testStorageConfiguration(config);
    spinner.succeed('Storage configuration valid');

    logger.success('\nAll tests passed! Your configuration is ready to use.');
  } catch (error) {
    spinner.fail('Test failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function testDatabaseConnection(config: any): Promise<void> {
  const dbConfig = config.database;

  if (dbConfig.type === 'sqlite') {
    if (!existsSync(dbConfig.sqlitePath)) {
      throw new Error(`SQLite database not found at ${dbConfig.sqlitePath}`);
    }
    return;
  }

  const psqlArgs = [
    '-h', dbConfig.host || 'localhost',
    '-p', String(dbConfig.port || 5432),
    '-U', dbConfig.username || 'postgres',
    '-d', dbConfig.database || 'postgres',
    '-c', 'SELECT 1',
    '--no-password',
  ];

  const env = {
    ...process.env,
    PGPASSWORD: dbConfig.password,
  };

  return new Promise<void>((resolve, reject) => {
    const psqlProcess = spawn('psql', psqlArgs, { env });

    let hasError = false;

    psqlProcess.stderr.on('data', (data) => {
      const message = data.toString();
      if (!message.includes('NOTICE')) {
        hasError = true;
        reject(new Error(`Database connection failed: ${message}`));
      }
    });

    psqlProcess.on('close', (code) => {
      if (!hasError) {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Database connection failed with exit code ${code}`));
        }
      }
    });

    psqlProcess.on('error', (error) => {
      reject(new Error(`Failed to execute psql: ${error.message}`));
    });
  });
}

async function testStorageConfiguration(config: any): Promise<void> {
  const storageConfig = config.storage;

  if (storageConfig.provider === 'local') {
    const path = storageConfig.local?.path || './backups';
    if (!existsSync(path)) {
      throw new Error(`Local storage path does not exist: ${path}`);
    }
  } else if (storageConfig.provider === 's3') {
    if (!storageConfig.s3?.bucket) {
      throw new Error('S3 bucket name is required');
    }
    if (!storageConfig.s3?.region) {
      throw new Error('S3 region is required');
    }
    if (!storageConfig.s3?.accessKeyId) {
      throw new Error('S3 access key ID is required');
    }
    if (!storageConfig.s3?.secretAccessKey) {
      throw new Error('S3 secret access key is required');
    }
  } else if (storageConfig.provider === 'cloudinary') {
    if (!storageConfig.cloudinary?.cloudName) {
      throw new Error('Cloudinary cloud name is required');
    }
    if (!storageConfig.cloudinary?.apiKey) {
      throw new Error('Cloudinary API key is required');
    }
    if (!storageConfig.cloudinary?.apiSecret) {
      throw new Error('Cloudinary API secret is required');
    }
  }
}
