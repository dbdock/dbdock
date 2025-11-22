import inquirer from 'inquirer';
import { saveConfig, configExists, CONFIG_FILE, CLIConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);

export async function initCommand(): Promise<void> {
  logger.info('DBDock Setup Wizard');

  if (configExists()) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `${CONFIG_FILE} already exists. Overwrite?`,
        default: false,
      },
    ]);

    if (!overwrite) {
      logger.warn('Setup cancelled');
      return;
    }
  }

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'dbType',
      message: 'Select database type:',
      choices: [
        { name: 'PostgreSQL', value: 'postgres' },
      ],
      default: 'postgres',
    },
    {
      type: 'input',
      name: 'host',
      message: 'Database host:',
      default: 'localhost',
    },
    {
      type: 'number',
      name: 'port',
      message: 'Database port:',
      default: 5432,
    },
    {
      type: 'input',
      name: 'username',
      message: 'Database username:',
      default: 'postgres',
    },
    {
      type: 'password',
      name: 'password',
      message: 'Database password:',
    },
    {
      type: 'input',
      name: 'database',
      message: 'Database name:',
    },
    {
      type: 'list',
      name: 'storageProvider',
      message: 'Select storage provider:',
      choices: [
        { name: 'Local Filesystem', value: 'local' },
        { name: 'AWS S3', value: 's3' },
        { name: 'Cloudflare R2 (S3-compatible)', value: 'r2' },
        { name: 'Cloudinary', value: 'cloudinary' },
      ],
      default: 'local',
    },
    {
      type: 'input',
      name: 'localPath',
      message: 'Local storage path:',
      default: './backups',
      when: (answers) => answers.storageProvider === 'local',
    },
    {
      type: 'input',
      name: 's3Bucket',
      message: 'S3/R2 bucket name:',
      when: (answers) => answers.storageProvider === 's3' || answers.storageProvider === 'r2',
    },
    {
      type: 'list',
      name: 's3Region',
      message: 'S3 region:',
      choices: [
        { name: 'US East (N. Virginia) - us-east-1', value: 'us-east-1' },
        { name: 'US East (Ohio) - us-east-2', value: 'us-east-2' },
        { name: 'US West (N. California) - us-west-1', value: 'us-west-1' },
        { name: 'US West (Oregon) - us-west-2', value: 'us-west-2' },
        { name: 'Europe (Ireland) - eu-west-1', value: 'eu-west-1' },
        { name: 'Europe (London) - eu-west-2', value: 'eu-west-2' },
        { name: 'Europe (Frankfurt) - eu-central-1', value: 'eu-central-1' },
        { name: 'Asia Pacific (Singapore) - ap-southeast-1', value: 'ap-southeast-1' },
        { name: 'Asia Pacific (Tokyo) - ap-northeast-1', value: 'ap-northeast-1' },
        { name: 'Asia Pacific (Sydney) - ap-southeast-2', value: 'ap-southeast-2' },
      ],
      default: 'us-east-1',
      when: (answers) => answers.storageProvider === 's3',
    },
    {
      type: 'input',
      name: 's3Region',
      message: 'R2 region:',
      default: 'auto',
      when: (answers) => answers.storageProvider === 'r2',
    },
    {
      type: 'input',
      name: 's3Endpoint',
      message: 'R2 endpoint (e.g., https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com):',
      when: (answers) => answers.storageProvider === 'r2',
    },
    {
      type: 'input',
      name: 's3AccessKey',
      message: 'Access key ID:',
      when: (answers) => answers.storageProvider === 's3' || answers.storageProvider === 'r2',
    },
    {
      type: 'password',
      name: 's3SecretKey',
      message: 'Secret access key:',
      when: (answers) => answers.storageProvider === 's3' || answers.storageProvider === 'r2',
    },
    {
      type: 'input',
      name: 'cloudinaryCloudName',
      message: 'Cloudinary cloud name:',
      when: (answers) => answers.storageProvider === 'cloudinary',
    },
    {
      type: 'input',
      name: 'cloudinaryApiKey',
      message: 'Cloudinary API key:',
      when: (answers) => answers.storageProvider === 'cloudinary',
    },
    {
      type: 'password',
      name: 'cloudinaryApiSecret',
      message: 'Cloudinary API secret:',
      when: (answers) => answers.storageProvider === 'cloudinary',
    },
    {
      type: 'confirm',
      name: 'enableEncryption',
      message: 'Enable encryption?',
      default: false,
    },
    {
      type: 'password',
      name: 'encryptionKey',
      message: 'Encryption key (32 characters):',
      when: (answers) => answers.enableEncryption,
      validate: (input: string) => {
        if (input.length !== 32) {
          return 'Encryption key must be exactly 32 characters';
        }
        return true;
      },
    },
    {
      type: 'confirm',
      name: 'enableCompression',
      message: 'Enable compression?',
      default: true,
    },
    {
      type: 'list',
      name: 'compressionLevel',
      message: 'Compression level:',
      choices: [
        { name: '1 - Fastest (least compression)', value: '1' },
        { name: '3 - Fast', value: '3' },
        { name: '6 - Balanced (recommended)', value: '6' },
        { name: '9 - Best compression (slowest)', value: '9' },
        { name: '11 - Maximum compression', value: '11' },
      ],
      default: '6',
      when: (answers) => answers.enableCompression,
    },
  ]);

  const config: CLIConfig = {
    database: {
      type: answers.dbType,
      host: answers.host,
      port: answers.port,
      username: answers.username,
      password: answers.password,
      database: answers.database,
    },
    storage: {
      provider: answers.storageProvider,
      ...(answers.storageProvider === 'local' && {
        local: { path: answers.localPath },
      }),
      ...((answers.storageProvider === 's3' || answers.storageProvider === 'r2') && {
        s3: {
          bucket: answers.s3Bucket,
          region: answers.s3Region,
          accessKeyId: answers.s3AccessKey,
          secretAccessKey: answers.s3SecretKey,
          ...(answers.s3Endpoint && { endpoint: answers.s3Endpoint }),
        },
      }),
      ...(answers.storageProvider === 'cloudinary' && {
        cloudinary: {
          cloudName: answers.cloudinaryCloudName,
          apiKey: answers.cloudinaryApiKey,
          apiSecret: answers.cloudinaryApiSecret,
        },
      }),
    },
    backup: {
      compression: {
        enabled: answers.enableCompression,
        level: answers.enableCompression ? parseInt(answers.compressionLevel) : undefined,
      },
      encryption: {
        enabled: answers.enableEncryption,
        key: answers.encryptionKey,
      },
    },
  };

  saveConfig(config);
  logger.success(`Configuration saved to ${CONFIG_FILE}`);
  logger.info('Next steps:');
  logger.log('  - Run "npx dbdock test" to verify your configuration');
  logger.log('  - Run "npx dbdock backup" to create your first backup');
}
