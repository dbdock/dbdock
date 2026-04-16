import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadSecretsFromEnv,
  mergeSecretsIntoConfig,
} from '../../config/secrets.validator';
import {
  getDbUrlFromEnv,
  parsePostgresUrlToConfig,
  applyDbUrlToCliDatabase,
} from '../../config/env-url.helper';

export const CONFIG_FILE = 'dbdock.config.json';

export interface CLIConfig {
  database: {
    type: string;
    host?: string;
    port?: number;
    username?: string;
    user?: string;

    password?: string;
    database?: string;
    sqlitePath?: string;
  };
  storage: {
    provider: string;
    local?: { path: string };
    localPath?: string;
    bucket?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    s3?: {
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint?: string;
    };
    r2?: {
      accountId: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
    cloudinary?: {
      cloudName: string;
      apiKey: string;
      apiSecret: string;
      folder?: string;
    };
  };
  backup?: {
    format?: 'custom' | 'plain' | 'directory' | 'tar';
    compression?: {
      enabled: boolean;
      level?: number;
    };
    encryption?: {
      enabled: boolean;
      key?: string;
    };
    retention?: {
      enabled: boolean;
      maxBackups?: number;
      maxAgeDays?: number;
      minBackups?: number;
      runAfterBackup?: boolean;
    };
    schedules?: Array<{
      name: string;
      cron: string;
      enabled: boolean;
    }>;
  };
  alerts?: {
    email?: {
      enabled: boolean;
      smtp: {
        host: string;
        port: number;
        secure: boolean;
        auth: {
          user: string;
          pass: string;
        };
      };
      from: string;
      to: string[];
      customTemplate?: string;
    };
    slack?: {
      enabled: boolean;
      webhookUrl: string;
    };
  };
}

export type ScheduleEntry = NonNullable<
  NonNullable<CLIConfig['backup']>['schedules']
>[number];

export function getConfigPath(): string {
  return process.env.DBDOCK_CONFIG_PATH || join(process.cwd(), CONFIG_FILE);
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

function loadConfigFromEnv(): CLIConfig {
  const dbUrl = getDbUrlFromEnv();
  let database: CLIConfig['database'];
  if (dbUrl) {
    const parsed = parsePostgresUrlToConfig(dbUrl);
    database = {
      type: 'postgres',
      host: parsed.host,
      port: parsed.port,
      username: parsed.user,
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
    };
  } else {
    const host =
      process.env.DB_HOST || process.env.DBDOCK_DB_HOST || 'localhost';
    const port = parseInt(
      process.env.DB_PORT || process.env.DBDOCK_DB_PORT || '5432',
    );
    const user =
      process.env.DB_USER || process.env.DBDOCK_DB_USER || 'postgres';
    const password =
      process.env.DBDOCK_DB_PASSWORD || process.env.DB_PASSWORD || '';
    const dbName =
      process.env.DB_NAME || process.env.DBDOCK_DB_NAME || 'postgres';
    database = {
      type: 'postgres',
      host,
      port: Number.isNaN(port) ? 5432 : port,
      username: user,
      user,
      password,
      database: dbName,
    };
  }
  const storageProvider =
    process.env.STORAGE_PROVIDER ||
    process.env.DBDOCK_STORAGE_PROVIDER ||
    'local';
  const storage: CLIConfig['storage'] = {
    provider: storageProvider,
  };
  if (storageProvider === 'local') {
    storage.local = {
      path:
        process.env.STORAGE_LOCAL_PATH ||
        process.env.DBDOCK_STORAGE_LOCAL_PATH ||
        './backups',
    };
  } else if (storageProvider === 's3' || storageProvider === 'r2') {
    storage.s3 = {
      bucket:
        process.env.STORAGE_BUCKET ||
        process.env.DBDOCK_STORAGE_BUCKET ||
        'dbdock-backups',
      region:
        process.env.STORAGE_REGION || process.env.AWS_REGION || 'us-east-1',
      accessKeyId:
        process.env.DBDOCK_STORAGE_ACCESS_KEY ||
        process.env.STORAGE_ACCESS_KEY ||
        '',
      secretAccessKey:
        process.env.DBDOCK_STORAGE_SECRET_KEY ||
        process.env.STORAGE_SECRET_KEY ||
        '',
      endpoint:
        process.env.STORAGE_ENDPOINT || process.env.DBDOCK_STORAGE_ENDPOINT,
    };
  } else if (storageProvider === 'cloudinary') {
    storage.cloudinary = {
      cloudName:
        process.env.CLOUDINARY_CLOUD_NAME ||
        process.env.DBDOCK_CLOUDINARY_CLOUD_NAME ||
        '',
      apiKey:
        process.env.DBDOCK_CLOUDINARY_API_KEY ||
        process.env.CLOUDINARY_API_KEY ||
        '',
      apiSecret:
        process.env.DBDOCK_CLOUDINARY_API_SECRET ||
        process.env.CLOUDINARY_API_SECRET ||
        '',
    };
  }
  const config: CLIConfig = { database, storage };
  const encryptionEnabled = process.env.ENCRYPTION_ENABLED !== 'false';
  if (encryptionEnabled) {
    config.backup = {
      encryption: {
        enabled: true,
        key:
          process.env.DBDOCK_ENCRYPTION_SECRET || process.env.ENCRYPTION_SECRET,
      },
    };
  }
  const smtpHost = process.env.SMTP_HOST || process.env.DBDOCK_SMTP_HOST;
  const slackWebhook =
    process.env.DBDOCK_SLACK_WEBHOOK || process.env.SLACK_WEBHOOK;
  if (smtpHost || slackWebhook) {
    config.alerts = {};
    if (smtpHost) {
      config.alerts.email = {
        enabled: true,
        smtp: {
          host: smtpHost,
          port: parseInt(
            process.env.SMTP_PORT || process.env.DBDOCK_SMTP_PORT || '587',
            10,
          ),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.DBDOCK_SMTP_USER || process.env.SMTP_USER || '',
            pass: process.env.DBDOCK_SMTP_PASS || process.env.SMTP_PASS || '',
          },
        },
        from: process.env.SMTP_FROM || process.env.DBDOCK_SMTP_FROM || '',
        to: (process.env.ALERT_EMAILS || process.env.DBDOCK_ALERT_EMAILS || '')
          .split(',')
          .filter(Boolean),
      };
    }
    if (slackWebhook) {
      config.alerts.slack = { enabled: true, webhookUrl: slackWebhook };
    }
  }
  return config;
}

export function loadConfig(): CLIConfig {
  const configPath = getConfigPath();
  let config: CLIConfig;
  if (!existsSync(configPath)) {
    config = loadConfigFromEnv();
  } else {
    const content = readFileSync(configPath, 'utf-8');
    config = JSON.parse(content) as CLIConfig;
  }

  const envSecrets = loadSecretsFromEnv();
  let mergedConfig = mergeSecretsIntoConfig(
    config as unknown as Record<string, unknown>,
    envSecrets,
  ) as unknown as CLIConfig & {
    postgres?: { password?: string };
    storage?: CLIConfig['storage'] & {
      accessKeyId?: string;
      secretAccessKey?: string;
      cloudinaryApiKey?: string;
      cloudinaryApiSecret?: string;
    };
    alerts?: CLIConfig['alerts'] & {
      smtpUser?: string;
      smtpPass?: string;
      slackWebhook?: string;
    };
  };
  mergedConfig = applyDbUrlToCliDatabase(
    mergedConfig as unknown as Record<string, unknown>,
  ) as unknown as typeof mergedConfig;

  if (mergedConfig.postgres?.password && !mergedConfig.database?.password) {
    mergedConfig.database.password = mergedConfig.postgres.password;
  }

  if (mergedConfig.storage) {
    const storage = mergedConfig.storage;
    const provider = storage.provider;

    if ((provider === 's3' || provider === 'r2') && storage.s3) {
      if (storage.accessKeyId && !storage.s3.accessKeyId) {
        storage.s3.accessKeyId = storage.accessKeyId;
      }
      if (storage.secretAccessKey && !storage.s3.secretAccessKey) {
        storage.s3.secretAccessKey = storage.secretAccessKey;
      }
    }

    if (provider === 'r2' && storage.r2 && !storage.s3) {
      if (storage.accessKeyId && !storage.r2.accessKeyId) {
        storage.r2.accessKeyId = storage.accessKeyId;
      }
      if (storage.secretAccessKey && !storage.r2.secretAccessKey) {
        storage.r2.secretAccessKey = storage.secretAccessKey;
      }
    }

    if (provider === 'cloudinary' && storage.cloudinary) {
      if (storage.cloudinaryApiKey && !storage.cloudinary.apiKey) {
        storage.cloudinary.apiKey = storage.cloudinaryApiKey;
      }
      if (storage.cloudinaryApiSecret && !storage.cloudinary.apiSecret) {
        storage.cloudinary.apiSecret = storage.cloudinaryApiSecret;
      }
    }
  }

  if (mergedConfig.alerts) {
    const alerts = mergedConfig.alerts;
    if (alerts?.smtpUser || alerts?.smtpPass) {
      if (alerts.email) {
        if (!alerts.email.smtp) {
          alerts.email.smtp = {
            host: '',
            port: 587,
            secure: false,
            auth: { user: '', pass: '' },
          };
        }
        if (!alerts.email.smtp.auth) {
          alerts.email.smtp.auth = { user: '', pass: '' };
        }
        if (alerts.smtpUser) {
          alerts.email.smtp.auth.user = alerts.smtpUser;
        }
        if (alerts.smtpPass) {
          alerts.email.smtp.auth.pass = alerts.smtpPass;
        }
      }
    }
    if (alerts?.slackWebhook && alerts.slack) {
      alerts.slack.webhookUrl = alerts.slackWebhook;
    }
  }

  return mergedConfig;
}

export function saveConfig(config: CLIConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
