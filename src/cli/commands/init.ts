import inquirer from 'inquirer';
import {
  saveConfig,
  configExists,
  CONFIG_FILE,
  CLIConfig,
} from '../utils/config';
import { logger } from '../utils/logger';
import { Logger } from '@nestjs/common';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';

const ENV_FILE = '.env';

Logger.overrideLogger(false);

interface InitAnswers {
  overwrite?: boolean;
  dbType: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  backupFormat: string;
  storageProvider: 'local' | 's3' | 'r2' | 'cloudinary';
  localPath?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  cloudinaryCloudName?: string;
  cloudinaryApiKey?: string;
  cloudinaryApiSecret?: string;
  enableEncryption: boolean;
  encryptionKey?: string;
  enableCompression: boolean;
  compressionLevel?: string;
  enableRetention: boolean;
  maxBackups?: number;
  maxAgeDays?: number;
  minBackups?: number;
  runRetentionAfterBackup?: boolean;
  enableEmailAlerts: boolean;
  enableSlackAlerts: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  emailFrom?: string;
  emailTo?: string;
  slackWebhook?: string;
}

export async function initCommand(): Promise<void> {
  logger.info('DBDock Setup Wizard');

  if (configExists()) {
    const { overwrite } = (await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `${CONFIG_FILE} already exists. Overwrite?`,
        default: false,
      },
    ])) as { overwrite: boolean };

    if (!overwrite) {
      logger.warn('Setup cancelled');
      return;
    }
  }

  const answers = (await inquirer.prompt([
    {
      type: 'list',
      name: 'dbType',
      message: 'Select database type:',
      choices: [{ name: 'PostgreSQL', value: 'postgres' }],
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
      message:
        'Database password (press Enter to skip and set via DBDOCK_DB_PASSWORD env var):',
    },
    {
      type: 'input',
      name: 'database',
      message: 'Database name:',
    },
    {
      type: 'list',
      name: 'backupFormat',
      message: 'Select backup format:',
      choices: [
        {
          name: 'Custom format (compressed binary, recommended)',
          value: 'custom',
        },
        { name: 'Plain SQL (text format)', value: 'plain' },
        { name: 'Directory format (parallel dump)', value: 'directory' },
        { name: 'Tar archive', value: 'tar' },
      ],
      default: 'custom',
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
      when: (answers: InitAnswers) => answers.storageProvider === 'local',
    },
    {
      type: 'input',
      name: 's3Bucket',
      message: 'S3/R2 bucket name:',
      when: (answers: InitAnswers) =>
        answers.storageProvider === 's3' || answers.storageProvider === 'r2',
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
        {
          name: 'Asia Pacific (Singapore) - ap-southeast-1',
          value: 'ap-southeast-1',
        },
        {
          name: 'Asia Pacific (Tokyo) - ap-northeast-1',
          value: 'ap-northeast-1',
        },
        {
          name: 'Asia Pacific (Sydney) - ap-southeast-2',
          value: 'ap-southeast-2',
        },
      ],
      default: 'us-east-1',
      when: (answers: InitAnswers) => answers.storageProvider === 's3',
    },
    {
      type: 'input',
      name: 's3Region',
      message: 'R2 region:',
      default: 'auto',
      when: (answers: InitAnswers) => answers.storageProvider === 'r2',
    },
    {
      type: 'input',
      name: 's3Endpoint',
      message:
        'R2 endpoint (e.g., https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com):',
      when: (answers: InitAnswers) => answers.storageProvider === 'r2',
    },
    {
      type: 'input',
      name: 's3AccessKey',
      message:
        'Access key ID (press Enter to skip and set via DBDOCK_STORAGE_ACCESS_KEY env var):',
      when: (answers: InitAnswers) =>
        answers.storageProvider === 's3' || answers.storageProvider === 'r2',
    },
    {
      type: 'password',
      name: 's3SecretKey',
      message:
        'Secret access key (press Enter to skip and set via DBDOCK_STORAGE_SECRET_KEY env var):',
      when: (answers: InitAnswers) =>
        answers.storageProvider === 's3' || answers.storageProvider === 'r2',
    },
    {
      type: 'input',
      name: 'cloudinaryCloudName',
      message: 'Cloudinary cloud name:',
      when: (answers: InitAnswers) => answers.storageProvider === 'cloudinary',
    },
    {
      type: 'input',
      name: 'cloudinaryApiKey',
      message:
        'Cloudinary API key (press Enter to skip and set via DBDOCK_CLOUDINARY_API_KEY env var):',
      when: (answers: InitAnswers) => answers.storageProvider === 'cloudinary',
    },
    {
      type: 'password',
      name: 'cloudinaryApiSecret',
      message:
        'Cloudinary API secret (press Enter to skip and set via DBDOCK_CLOUDINARY_API_SECRET env var):',
      when: (answers: InitAnswers) => answers.storageProvider === 'cloudinary',
    },
    {
      type: 'confirm',
      name: 'enableEncryption',
      message: 'Enable encryption?',
      default: false,
    },
    {
      type: 'input',
      name: 'encryptionKey',
      message:
        'Encryption key (64-char hex, run: openssl rand -hex 32, press Enter to skip and set via DBDOCK_ENCRYPTION_SECRET env var):',
      when: (answers: InitAnswers) => answers.enableEncryption,
      validate: (input: string) => {
        if (!input.trim()) return true;
        if (!/^[0-9a-fA-F]{64}$/.test(input)) {
          return 'Encryption key must be a 64-character hexadecimal string. Generate with: openssl rand -hex 32';
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
      when: (answers: InitAnswers) => answers.enableCompression,
    },
    {
      type: 'confirm',
      name: 'enableRetention',
      message: 'Enable automatic backup cleanup (retention policy)?',
      default: true,
    },
    {
      type: 'number',
      name: 'maxBackups',
      message: 'Maximum number of backups to keep:',
      default: 100,
      when: (answers: InitAnswers) => answers.enableRetention,
      validate: (input: number) => {
        if (input < 1) {
          return 'Must keep at least 1 backup';
        }
        return true;
      },
    },
    {
      type: 'number',
      name: 'maxAgeDays',
      message: 'Delete backups older than (days):',
      default: 30,
      when: (answers: InitAnswers) => answers.enableRetention,
      validate: (input: number) => {
        if (input < 1) {
          return 'Must be at least 1 day';
        }
        return true;
      },
    },
    {
      type: 'number',
      name: 'minBackups',
      message: 'Minimum backups to always keep (safety net):',
      default: 5,
      when: (answers: InitAnswers) => answers.enableRetention,
      validate: (input: number) => {
        if (input < 1) {
          return 'Must keep at least 1 backup';
        }
        return true;
      },
    },
    {
      type: 'confirm',
      name: 'runRetentionAfterBackup',
      message: 'Run cleanup automatically after each backup?',
      default: true,
      when: (answers: InitAnswers) => answers.enableRetention,
    },
    {
      type: 'confirm',
      name: 'enableEmailAlerts',
      message: 'Enable Email alerts?',
      default: false,
    },
    {
      type: 'confirm',
      name: 'enableSlackAlerts',
      message: 'Enable Slack alerts?',
      default: false,
    },
    {
      type: 'input',
      name: 'smtpHost',
      message: 'SMTP host:',
      default: 'smtp.gmail.com',
      when: (answers: InitAnswers) => answers.enableEmailAlerts,
    },
    {
      type: 'number',
      name: 'smtpPort',
      message: 'SMTP port:',
      default: 587,
      when: (answers: InitAnswers) => answers.enableEmailAlerts,
    },
    {
      type: 'confirm',
      name: 'smtpSecure',
      message: 'Use secure connection (TLS)?',
      default: false,
      when: (answers: InitAnswers) => answers.enableEmailAlerts,
    },
    {
      type: 'input',
      name: 'smtpUser',
      message: 'SMTP username/email (press Enter to skip):',
      when: (answers: InitAnswers) => answers.enableEmailAlerts,
    },
    {
      type: 'password',
      name: 'smtpPassword',
      message: 'SMTP password/app password (press Enter to skip):',
      when: (answers: InitAnswers) => answers.enableEmailAlerts,
    },
    {
      type: 'input',
      name: 'emailFrom',
      message: 'From email address (press Enter to skip):',
      when: (answers: InitAnswers) => answers.enableEmailAlerts,
      validate: (input: string) => {
        if (!input.trim()) return true;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) {
          return 'Please enter a valid email address';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'emailTo',
      message: 'To email address(es) (comma-separated, press Enter to skip):',
      when: (answers: InitAnswers) => answers.enableEmailAlerts,
      validate: (input: string) => {
        if (!input.trim()) return true;
        const emails = input.split(',').map((e) => e.trim());
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const allValid = emails.every((email) => emailRegex.test(email));
        if (!allValid) {
          return 'Please enter valid email address(es) separated by commas';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'slackWebhook',
      message: 'Slack Webhook URL (press Enter to skip):',
      when: (answers: InitAnswers) => answers.enableSlackAlerts,
      validate: (input: string) => {
        if (!input.trim()) return true;
        if (!input.trim().startsWith('https://hooks.slack.com/services/')) {
          return 'Please enter a valid Slack Webhook URL (starts with https://hooks.slack.com/services/)';
        }
        return true;
      },
    },
  ])) as InitAnswers;

  const config: CLIConfig = {
    database: {
      type: answers.dbType,
      host: answers.host,
      port: answers.port,
      username: answers.username,
      password: answers.password,
      database: answers.database,
    },
    backup: {
      format: answers.backupFormat as 'custom' | 'plain' | 'directory' | 'tar',
      compression: {
        enabled: answers.enableCompression,
        level: answers.enableCompression
          ? parseInt(answers.compressionLevel || '6')
          : undefined,
      },
      encryption: {
        enabled: answers.enableEncryption,
        key: answers.encryptionKey,
      },
      ...(answers.enableRetention && {
        retention: {
          enabled: true,
          maxBackups: answers.maxBackups,
          maxAgeDays: answers.maxAgeDays,
          minBackups: answers.minBackups,
          runAfterBackup: answers.runRetentionAfterBackup,
        },
      }),
    },
    storage: {
      provider: answers.storageProvider,
      ...(answers.storageProvider === 'local' &&
        answers.localPath && {
          local: { path: answers.localPath },
        }),
      ...((answers.storageProvider === 's3' ||
        answers.storageProvider === 'r2') &&
        answers.s3Bucket &&
        answers.s3Region &&
        answers.s3AccessKey &&
        answers.s3SecretKey && {
          s3: {
            bucket: answers.s3Bucket,
            region: answers.s3Region,
            accessKeyId: answers.s3AccessKey,
            secretAccessKey: answers.s3SecretKey,
            ...(answers.s3Endpoint && { endpoint: answers.s3Endpoint }),
          },
        }),
      ...(answers.storageProvider === 'cloudinary' &&
        answers.cloudinaryCloudName &&
        answers.cloudinaryApiKey &&
        answers.cloudinaryApiSecret && {
          cloudinary: {
            cloudName: answers.cloudinaryCloudName,
            apiKey: answers.cloudinaryApiKey,
            apiSecret: answers.cloudinaryApiSecret,
          },
        }),
    },
    ...((answers.enableEmailAlerts || answers.enableSlackAlerts) && {
      alerts: {
        ...(answers.enableEmailAlerts &&
          answers.smtpHost &&
          answers.smtpPort !== undefined &&
          answers.smtpSecure !== undefined &&
          answers.smtpUser &&
          answers.smtpPassword &&
          answers.emailFrom &&
          answers.emailTo && {
            email: {
              enabled: true,
              smtp: {
                host: answers.smtpHost,
                port: answers.smtpPort,
                secure: answers.smtpSecure,
                auth: {
                  user: answers.smtpUser,
                  pass: answers.smtpPassword,
                },
              },
              from: answers.emailFrom,
              to: answers.emailTo
                .split(',')
                .map((email: string) => email.trim()),
            },
          }),
        ...(answers.enableSlackAlerts &&
          answers.slackWebhook && {
            slack: {
              enabled: true,
              webhookUrl: answers.slackWebhook,
            },
          }),
      },
    }),
  };

  const secrets = extractSecrets(answers);
  const configWithoutSecrets = removeSecretsFromConfig(config);

  saveConfig(configWithoutSecrets);
  logger.success(`Configuration saved to ${CONFIG_FILE}`);

  if (Object.keys(secrets).length > 0) {
    saveSecretsToEnvFile(secrets);
    logger.success(`Secrets saved to ${ENV_FILE}`);
  }

  if (config.storage.provider === 'local' && config.storage.local?.path) {
    const localPath = config.storage.local.path;
    if (!existsSync(localPath)) {
      mkdirSync(localPath, { recursive: true });
      logger.success(`Created local storage directory: ${localPath}`);
    }
  }

  const gitignoreStatus = updateGitignore(
    config,
    Object.keys(secrets).length > 0,
  );

  if (gitignoreStatus.created) {
    logger.success(`.gitignore created`);
  }

  if (gitignoreStatus.localPathUpdated) {
    logger.success(`${config.storage.local?.path} added to .gitignore`);
  } else if (gitignoreStatus.localPathAlreadyExists) {
    logger.info(`${config.storage.local?.path} is already in .gitignore`);
  }

  if (gitignoreStatus.envUpdated) {
    logger.success(`${ENV_FILE} added to .gitignore`);
  } else if (gitignoreStatus.envAlreadyExists) {
    logger.info(`${ENV_FILE} is already in .gitignore`);
  }

  if (answers.enableEmailAlerts || answers.enableSlackAlerts) {
    logger.info('\nNote: Alerts are configured but only work with:');
    logger.log('  - Programmatic usage (NestJS module)');
    logger.log('  - Scheduled backups (cron jobs via the schedule module)');
    logger.log(
      '  - Manual CLI commands (npx dbdock backup) do NOT send alerts',
    );
  }

  if (Object.keys(secrets).length > 0) {
    logger.info('\n🔐 Security Configuration:');
    logger.log(
      `  - Non-sensitive config saved to: ${CONFIG_FILE} (safe for version control)`,
    );
    logger.log(`  - Secrets saved to: ${ENV_FILE} (DO NOT commit this file)`);
    logger.log(`  - ${ENV_FILE} has been added to .gitignore`);
  }

  logger.info('\nNext steps:');
  logger.log('  - Run "npx dbdock test" to verify your configuration');
  logger.log('  - Run "npx dbdock backup" to create your first backup');
}

interface SecretsMap {
  [key: string]: string;
}

function extractSecrets(answers: InitAnswers): SecretsMap {
  const secrets: SecretsMap = {};

  if (answers.password) {
    secrets.DBDOCK_DB_PASSWORD = answers.password;
  }

  if (answers.s3AccessKey) {
    secrets.DBDOCK_STORAGE_ACCESS_KEY = answers.s3AccessKey;
  }

  if (answers.s3SecretKey) {
    secrets.DBDOCK_STORAGE_SECRET_KEY = answers.s3SecretKey;
  }

  if (answers.cloudinaryApiKey) {
    secrets.DBDOCK_CLOUDINARY_API_KEY = answers.cloudinaryApiKey;
  }

  if (answers.cloudinaryApiSecret) {
    secrets.DBDOCK_CLOUDINARY_API_SECRET = answers.cloudinaryApiSecret;
  }

  if (answers.encryptionKey) {
    secrets.DBDOCK_ENCRYPTION_SECRET = answers.encryptionKey;
  }

  if (answers.smtpUser) {
    secrets.DBDOCK_SMTP_USER = answers.smtpUser;
  }

  if (answers.smtpPassword) {
    secrets.DBDOCK_SMTP_PASS = answers.smtpPassword;
  }

  if (answers.slackWebhook) {
    secrets.DBDOCK_SLACK_WEBHOOK = answers.slackWebhook;
  }

  return secrets;
}

function removeSecretsFromConfig(config: CLIConfig): CLIConfig {
  type MutableRecord = Record<string, unknown>;
  const cleaned = JSON.parse(JSON.stringify(config)) as CLIConfig;

  if (cleaned.database) {
    delete cleaned.database.password;
  }

  if (cleaned.storage?.s3) {
    const s3 = cleaned.storage.s3 as unknown as MutableRecord;
    delete s3.accessKeyId;
    delete s3.secretAccessKey;
  }

  if (cleaned.storage?.cloudinary) {
    const cloudinary = cleaned.storage.cloudinary as unknown as MutableRecord;
    delete cloudinary.apiKey;
    delete cloudinary.apiSecret;
  }

  if (cleaned.backup?.encryption) {
    delete cleaned.backup.encryption.key;
  }

  if (cleaned.alerts?.email?.smtp?.auth) {
    const smtp = cleaned.alerts.email.smtp as unknown as MutableRecord;
    delete smtp.auth;
  }

  if (cleaned.alerts?.slack) {
    const slack = cleaned.alerts.slack as unknown as MutableRecord;
    delete slack.webhookUrl;
  }

  return cleaned;
}

function saveSecretsToEnvFile(secrets: SecretsMap): void {
  const envPath = join(process.cwd(), ENV_FILE);

  const lines = [
    '# DBDock Secrets - DO NOT COMMIT THIS FILE',
    '# Generated by dbdock init',
    '',
  ];

  for (const [key, value] of Object.entries(secrets)) {
    lines.push(`${key}=${value}`);
  }

  lines.push('');

  writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
}

interface GitignoreStatus {
  localPathUpdated: boolean;
  localPathAlreadyExists: boolean;
  envUpdated: boolean;
  envAlreadyExists: boolean;
  created: boolean;
}

function updateGitignore(
  config: CLIConfig,
  hasSecrets: boolean = false,
): GitignoreStatus {
  const gitignorePath = join(process.cwd(), '.gitignore');
  const entriesToAdd: string[] = [];

  if (config.storage.provider === 'local' && config.storage.local?.path) {
    const localPath = config.storage.local.path;
    const normalizedPath = localPath.replace(/^\.\//, '').replace(/\/$/, '');
    entriesToAdd.push(normalizedPath);
  }

  if (hasSecrets) {
    entriesToAdd.push(ENV_FILE);
  }

  const status: GitignoreStatus = {
    localPathUpdated: false,
    localPathAlreadyExists: false,
    envUpdated: false,
    envAlreadyExists: false,
    created: false,
  };

  if (!existsSync(gitignorePath)) {
    if (entriesToAdd.length > 0) {
      writeFileSync(gitignorePath, entriesToAdd.join('\n') + '\n');
      status.created = true;
      if (config.storage.provider === 'local' && config.storage.local?.path) {
        status.localPathUpdated = true;
      }
      if (hasSecrets) {
        status.envUpdated = true;
      }
    }
    return status;
  }

  const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
  const lines = gitignoreContent.split('\n');

  const isEntryIgnored = (entry: string) => {
    return lines.some((line) => {
      const trimmed = line.trim();
      return (
        trimmed === entry ||
        trimmed === `/${entry}` ||
        trimmed === `./${entry}` ||
        trimmed === `${entry}/`
      );
    });
  };

  let localPathAlreadyIgnored = false;
  if (config.storage.provider === 'local' && config.storage.local?.path) {
    const normalizedPath = config.storage.local.path
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
    localPathAlreadyIgnored = isEntryIgnored(normalizedPath);
    status.localPathAlreadyExists = localPathAlreadyIgnored;
  }

  let envAlreadyIgnored = false;
  if (hasSecrets) {
    envAlreadyIgnored = isEntryIgnored(ENV_FILE);
    status.envAlreadyExists = envAlreadyIgnored;
  }

  const newEntries: string[] = [];

  if (
    config.storage.provider === 'local' &&
    config.storage.local?.path &&
    !localPathAlreadyIgnored
  ) {
    const normalizedPath = config.storage.local.path
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
    newEntries.push(normalizedPath);
    status.localPathUpdated = true;
  }

  if (hasSecrets && !envAlreadyIgnored) {
    newEntries.push(ENV_FILE);
    status.envUpdated = true;
  }

  if (newEntries.length > 0) {
    const needsNewline =
      gitignoreContent.length > 0 && !gitignoreContent.endsWith('\n');
    const contentToAdd = needsNewline
      ? `\n${newEntries.join('\n')}\n`
      : `${newEntries.join('\n')}\n`;
    appendFileSync(gitignorePath, contentToAdd);
  }

  return status;
}
