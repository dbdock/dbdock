import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectLocalResources } from './collectors';

const FULL_CONFIG = {
  database: {
    type: 'postgresql',
    host: 'db.internal',
    port: 5432,
    username: 'admin',
    password: 'PG_SECRET_PW',
    database: 'app',
  },
  storage: {
    provider: 's3',
    s3: {
      bucket: 'backups',
      region: 'us-east-1',
      endpoint: 'https://s3.example',
      accessKeyId: 'AKIA_SECRET',
      secretAccessKey: 'SECRET_KEY_VALUE',
    },
    cloudinary: {
      cloudName: 'cloud',
      apiKey: 'CLOUD_KEY',
      apiSecret: 'CLOUD_SECRET',
      folder: 'f',
    },
  },
  backup: {
    format: 'custom',
    compression: { enabled: true, level: 6 },
    encryption: { enabled: true, key: 'ENCRYPTION_SECRET' },
    retention: { enabled: true, maxBackups: 10 },
    schedules: [{ name: 'nightly', cron: '0 2 * * *', enabled: true }],
  },
  alerts: {
    email: {
      enabled: true,
      smtp: {
        host: 'smtp.example',
        port: 587,
        secure: false,
        auth: { user: 'ops', pass: 'SMTP_SECRET' },
      },
      from: 'ops@example',
      to: ['a@example'],
    },
    slack: { enabled: true, webhookUrl: 'https://hooks.example/SLACK_SECRET' },
  },
};

const SECRET_VALUES = [
  'PG_SECRET_PW',
  'AKIA_SECRET',
  'SECRET_KEY_VALUE',
  'CLOUD_KEY',
  'CLOUD_SECRET',
  'ENCRYPTION_SECRET',
  'SMTP_SECRET',
  'SLACK_SECRET',
];

const SECRET_FIELDS = [
  'password',
  'accessKeyId',
  'secretAccessKey',
  'apiKey',
  'apiSecret',
  'webhookUrl',
];

describe('collectLocalResources', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dbdock-collectors-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(config: unknown): void {
    writeFileSync(join(dir, 'dbdock.config.json'), JSON.stringify(config));
  }

  it('returns [] when no config file exists', () => {
    expect(collectLocalResources(dir)).toEqual([]);
  });

  it('collects a resource per configured section (incl. one per schedule)', () => {
    writeConfig(FULL_CONFIG);
    const kinds = collectLocalResources(dir)
      .map((r) => r.resource)
      .sort();
    expect(kinds).toEqual([
      'alerts',
      'backup',
      'connection',
      'schedule',
      'storage',
    ]);
  });

  it('never emits any secret value or secret field name', () => {
    writeConfig(FULL_CONFIG);
    const serialized = JSON.stringify(collectLocalResources(dir));
    for (const secret of SECRET_VALUES) {
      expect(serialized).not.toContain(secret);
    }
    for (const field of SECRET_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it('keeps safe connection metadata but drops the password', () => {
    writeConfig(FULL_CONFIG);
    const connection = collectLocalResources(dir).find(
      (r) => r.resource === 'connection',
    );
    expect(connection?.data).toEqual({
      type: 'postgresql',
      host: 'db.internal',
      port: 5432,
      database: 'app',
      user: 'admin',
    });
  });

  it('keeps non-secret storage metadata across nested providers', () => {
    writeConfig(FULL_CONFIG);
    const storage = collectLocalResources(dir).find(
      (r) => r.resource === 'storage',
    );
    expect(storage?.data).toMatchObject({
      provider: 's3',
      bucket: 'backups',
      region: 'us-east-1',
      endpoint: 'https://s3.example',
      cloudinaryCloudName: 'cloud',
      cloudinaryFolder: 'f',
    });
  });

  it('emits one schedule resource per configured schedule, keyed by name', () => {
    writeConfig(FULL_CONFIG);
    const schedule = collectLocalResources(dir).find(
      (r) => r.resource === 'schedule',
    );
    expect(schedule?.id).toBe('nightly');
    expect(schedule?.data).toEqual({
      name: 'nightly',
      cron: '0 2 * * *',
      enabled: true,
    });
  });

  it('represents alert secrets as presence flags', () => {
    writeConfig(FULL_CONFIG);
    const alerts = collectLocalResources(dir).find(
      (r) => r.resource === 'alerts',
    );
    expect(alerts?.data).toMatchObject({
      emailEnabled: true,
      emailFrom: 'ops@example',
      smtpHost: 'smtp.example',
      smtpPort: 587,
      smtpSecure: false,
      hasSmtpAuth: true,
      slackEnabled: true,
      hasSlackWebhook: true,
    });
  });

  it('omits optional sections that are absent', () => {
    writeConfig({
      database: { type: 'postgresql', host: 'h', port: 5432, database: 'd' },
      storage: { provider: 'local', localPath: './backups' },
    });
    const kinds = collectLocalResources(dir)
      .map((r) => r.resource)
      .sort();
    expect(kinds).toEqual(['connection', 'storage']);
  });
});
