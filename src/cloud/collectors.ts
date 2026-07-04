import { join } from 'path';
import { readJsonFile } from './fs-utils';
import { ResourceInput } from './snapshot';

const CONFIG_FILE = 'dbdock.config.json';

// Raw shape of dbdock.config.json. Secret fields are typed here on purpose so
// it is explicit which values exist and are DELIBERATELY excluded from the
// cloud snapshot. Never spread these sections into resource data — allowlist
// only the non-secret fields below.
interface RawConfig {
  postgres?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
  storage?: {
    provider?: string;
    endpoint?: string;
    bucket?: string;
    region?: string;
    localPath?: string;
    cloudinaryCloudName?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    cloudinaryApiKey?: string;
    cloudinaryApiSecret?: string;
  };
  encryption?: {
    enabled?: boolean;
    iterations?: number;
    secret?: string;
  };
  schedule?: {
    type?: string;
    expression?: string;
  };
  pitr?: {
    enabled?: boolean;
    walIntervalSeconds?: number;
    retentionDays?: number;
  };
  alerts?: {
    smtpHost?: string;
    smtpPort?: number;
    from?: string;
    to?: string[];
    smtpPass?: string;
    slackWebhook?: string;
    customWebhook?: string;
  };
}

function put(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}

// Collect the local resources this project should mirror to DBDock Cloud from
// dbdock.config.json. Only non-secret metadata is emitted; credentials
// (passwords, storage keys, encryption/SMTP secrets, webhook URLs) are dropped
// and represented as boolean presence flags where useful.
export function collectLocalResources(
  cwd: string = process.cwd(),
): ResourceInput[] {
  const config = readJsonFile<RawConfig>(join(cwd, CONFIG_FILE));
  if (!config) {
    return [];
  }

  const resources: ResourceInput[] = [];

  if (config.postgres) {
    const pg = config.postgres;
    const data: Record<string, unknown> = { type: 'postgresql' };
    put(data, 'host', pg.host);
    put(data, 'port', pg.port);
    put(data, 'database', pg.database);
    put(data, 'user', pg.user);
    resources.push({ resource: 'connection', id: 'default', data });
  }

  if (config.storage) {
    const storage = config.storage;
    const data: Record<string, unknown> = {};
    put(data, 'provider', storage.provider);
    put(data, 'bucket', storage.bucket);
    put(data, 'region', storage.region);
    put(data, 'endpoint', storage.endpoint);
    put(data, 'localPath', storage.localPath);
    put(data, 'cloudinaryCloudName', storage.cloudinaryCloudName);
    resources.push({ resource: 'storage', id: 'default', data });
  }

  if (config.encryption) {
    const encryption = config.encryption;
    const data: Record<string, unknown> = {};
    put(data, 'enabled', encryption.enabled);
    put(data, 'iterations', encryption.iterations);
    resources.push({ resource: 'encryption', id: 'default', data });
  }

  if (config.schedule) {
    const schedule = config.schedule;
    const data: Record<string, unknown> = {};
    put(data, 'type', schedule.type);
    put(data, 'expression', schedule.expression);
    resources.push({ resource: 'schedule', id: 'default', data });
  }

  if (config.pitr) {
    const pitr = config.pitr;
    const data: Record<string, unknown> = {};
    put(data, 'enabled', pitr.enabled);
    put(data, 'walIntervalSeconds', pitr.walIntervalSeconds);
    put(data, 'retentionDays', pitr.retentionDays);
    resources.push({ resource: 'pitr', id: 'default', data });
  }

  if (config.alerts) {
    const alerts = config.alerts;
    const data: Record<string, unknown> = {};
    put(data, 'smtpHost', alerts.smtpHost);
    put(data, 'smtpPort', alerts.smtpPort);
    put(data, 'from', alerts.from);
    put(data, 'to', alerts.to);
    data.hasSmtpAuth = Boolean(alerts.smtpPass);
    data.hasSlackWebhook = Boolean(alerts.slackWebhook);
    data.hasCustomWebhook = Boolean(alerts.customWebhook);
    resources.push({ resource: 'alerts', id: 'default', data });
  }

  return resources;
}
