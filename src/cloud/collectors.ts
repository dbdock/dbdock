import { join } from 'path';
import type { CLIConfig } from '../cli/utils/config';
import { readJsonFile } from './fs-utils';
import { ResourceInput } from './snapshot';

const CONFIG_FILE = 'dbdock.config.json';

// Collect the local resources this project mirrors to DBDock Cloud from
// dbdock.config.json. This reads the authoritative CLIConfig shape (type-only
// import) so any change to the config surfaces here as a compile error.
//
// SECURITY: only non-secret metadata is emitted. Credentials — DB passwords,
// storage access/secret keys, Cloudinary api secrets, encryption keys, SMTP
// passwords, Slack/custom webhook URLs — are NEVER put into resource data.
// Secrets are dropped, or represented as boolean presence flags where useful.

function put(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}

export function collectLocalResources(
  cwd: string = process.cwd(),
): ResourceInput[] {
  const config = readJsonFile<CLIConfig>(join(cwd, CONFIG_FILE));
  if (!config) {
    return [];
  }

  const resources: ResourceInput[] = [];

  collectConnection(config, resources);
  collectStorage(config, resources);
  collectBackup(config, resources);
  collectSchedules(config, resources);
  collectAlerts(config, resources);

  return resources;
}

function collectConnection(
  config: CLIConfig,
  resources: ResourceInput[],
): void {
  const db = config.database;
  if (!db) {
    return;
  }
  const data: Record<string, unknown> = {};
  put(data, 'type', db.type);
  put(data, 'host', db.host);
  put(data, 'port', db.port);
  put(data, 'database', db.database);
  put(data, 'user', db.username ?? db.user);
  put(data, 'sqlitePath', db.sqlitePath);
  resources.push({ resource: 'connection', id: 'default', data });
}

function collectStorage(config: CLIConfig, resources: ResourceInput[]): void {
  const storage = config.storage;
  if (!storage) {
    return;
  }
  const data: Record<string, unknown> = {};
  put(data, 'provider', storage.provider);
  put(data, 'bucket', storage.bucket ?? storage.s3?.bucket ?? storage.r2?.bucket);
  put(data, 'region', storage.s3?.region);
  put(data, 'endpoint', storage.endpoint ?? storage.s3?.endpoint);
  put(data, 'localPath', storage.localPath ?? storage.local?.path);
  put(data, 'r2AccountId', storage.r2?.accountId);
  put(data, 'cloudinaryCloudName', storage.cloudinary?.cloudName);
  put(data, 'cloudinaryFolder', storage.cloudinary?.folder);
  resources.push({ resource: 'storage', id: 'default', data });
}

function collectBackup(config: CLIConfig, resources: ResourceInput[]): void {
  const backup = config.backup;
  if (!backup) {
    return;
  }
  const data: Record<string, unknown> = {};
  put(data, 'format', backup.format);
  if (backup.compression) {
    put(data, 'compressionEnabled', backup.compression.enabled);
    put(data, 'compressionLevel', backup.compression.level);
  }
  if (backup.encryption) {
    put(data, 'encryptionEnabled', backup.encryption.enabled);
  }
  if (backup.retention) {
    put(data, 'retentionEnabled', backup.retention.enabled);
    put(data, 'retentionMaxBackups', backup.retention.maxBackups);
    put(data, 'retentionMaxAgeDays', backup.retention.maxAgeDays);
    put(data, 'retentionMinBackups', backup.retention.minBackups);
    put(data, 'retentionRunAfterBackup', backup.retention.runAfterBackup);
  }
  resources.push({ resource: 'backup', id: 'default', data });
}

function collectSchedules(
  config: CLIConfig,
  resources: ResourceInput[],
): void {
  const schedules = config.backup?.schedules;
  if (!schedules || schedules.length === 0) {
    return;
  }
  for (const schedule of schedules) {
    const data: Record<string, unknown> = {};
    put(data, 'name', schedule.name);
    put(data, 'cron', schedule.cron);
    put(data, 'enabled', schedule.enabled);
    resources.push({
      resource: 'schedule',
      id: schedule.name || 'default',
      data,
    });
  }
}

function collectAlerts(config: CLIConfig, resources: ResourceInput[]): void {
  const alerts = config.alerts;
  if (!alerts) {
    return;
  }
  const data: Record<string, unknown> = {};
  if (alerts.email) {
    data.emailEnabled = Boolean(alerts.email.enabled);
    put(data, 'emailFrom', alerts.email.from);
    put(data, 'emailTo', alerts.email.to);
    put(data, 'smtpHost', alerts.email.smtp?.host);
    put(data, 'smtpPort', alerts.email.smtp?.port);
    put(data, 'smtpSecure', alerts.email.smtp?.secure);
    data.hasSmtpAuth = Boolean(
      alerts.email.smtp?.auth?.user || alerts.email.smtp?.auth?.pass,
    );
  }
  if (alerts.slack) {
    data.slackEnabled = Boolean(alerts.slack.enabled);
    data.hasSlackWebhook = Boolean(alerts.slack.webhookUrl);
  }
  resources.push({ resource: 'alerts', id: 'default', data });
}
