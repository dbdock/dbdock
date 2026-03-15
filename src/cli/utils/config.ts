import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadSecretsFromEnv,
  mergeSecretsIntoConfig,
} from '../../config/secrets.validator';

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
  };
  storage: {
    provider: string;
    local?: { path: string };
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

export function getConfigPath(): string {
  return process.env.DBDOCK_CONFIG_PATH || join(process.cwd(), CONFIG_FILE);
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): CLIConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }
  const content = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(content) as CLIConfig;

  const envSecrets = loadSecretsFromEnv();
  const mergedConfig = mergeSecretsIntoConfig(
    config as unknown as Record<string, unknown>,
    envSecrets
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
    const alerts = mergedConfig.alerts as typeof mergedConfig.alerts;
    if (alerts?.smtpUser || alerts?.smtpPass) {
      if (alerts.email) {
        if (!alerts.email.smtp) {
          alerts.email.smtp = { host: '', port: 587, secure: false, auth: { user: '', pass: '' } };
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

  return mergedConfig as CLIConfig;
}

export function saveConfig(config: CLIConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
