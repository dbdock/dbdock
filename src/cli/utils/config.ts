import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export const CONFIG_FILE = 'dbdock.config.json';

export interface CLIConfig {
  database: {
    type: string;
    host?: string;
    port?: number;
    username?: string;
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
  return JSON.parse(content);
}

export function saveConfig(config: CLIConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
