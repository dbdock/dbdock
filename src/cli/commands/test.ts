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

    if (config.alerts?.email?.enabled) {
      spinner.start('Testing email configuration...');
      await testEmailConfiguration(config);
      spinner.succeed('Email configuration valid');
    }

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
  } else if (storageConfig.provider === 's3' || storageConfig.provider === 'r2') {
    if (!storageConfig.s3?.bucket) {
      throw new Error('S3/R2 bucket name is required');
    }
    if (!storageConfig.s3?.region) {
      throw new Error('S3/R2 region is required');
    }
    if (!storageConfig.s3?.accessKeyId) {
      throw new Error('S3/R2 access key ID is required');
    }
    if (!storageConfig.s3?.secretAccessKey) {
      throw new Error('S3/R2 secret access key is required');
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

async function testEmailConfiguration(config: any): Promise<void> {
  const emailConfig = config.alerts?.email;

  if (!emailConfig) {
    throw new Error('Email configuration is missing');
  }

  if (!emailConfig.smtp?.host) {
    throw new Error('SMTP host is required');
  }

  if (!emailConfig.smtp?.port) {
    throw new Error('SMTP port is required');
  }

  if (!emailConfig.smtp?.auth?.user) {
    throw new Error('SMTP username is required');
  }

  if (!emailConfig.smtp?.auth?.pass) {
    throw new Error('SMTP password is required');
  }

  if (!emailConfig.from) {
    throw new Error('From email address is required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailConfig.from)) {
    throw new Error(`Invalid from email address: ${emailConfig.from}`);
  }

  if (!emailConfig.to || emailConfig.to.length === 0) {
    throw new Error('At least one recipient email address is required');
  }

  for (const email of emailConfig.to) {
    if (!emailRegex.test(email)) {
      throw new Error(`Invalid recipient email address: ${email}`);
    }
  }

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: emailConfig.smtp.host,
    port: emailConfig.smtp.port,
    secure: emailConfig.smtp.secure,
    auth: {
      user: emailConfig.smtp.auth.user,
      pass: emailConfig.smtp.auth.pass,
    },
  });

  try {
    await transporter.verify();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Invalid login')) {
      throw new Error('SMTP authentication failed. Please check your username and password');
    } else if (errorMessage.includes('ECONNREFUSED')) {
      throw new Error(`Cannot connect to SMTP server at ${emailConfig.smtp.host}:${emailConfig.smtp.port}`);
    } else if (errorMessage.includes('ETIMEDOUT')) {
      throw new Error(`Connection timeout to SMTP server at ${emailConfig.smtp.host}:${emailConfig.smtp.port}`);
    } else {
      throw new Error(`SMTP connection failed: ${errorMessage}`);
    }
  }
}
