import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectLocalResources } from './collectors';

const FULL_CONFIG = {
  postgres: {
    host: 'db.internal',
    port: 5432,
    user: 'admin',
    password: 'PG_SECRET_PW',
    database: 'app',
  },
  storage: {
    provider: 's3',
    bucket: 'backups',
    region: 'us-east-1',
    endpoint: 'https://s3.example',
    accessKeyId: 'AKIA_SECRET',
    secretAccessKey: 'SECRET_KEY_VALUE',
    cloudinaryCloudName: 'cloud',
    cloudinaryApiKey: 'CLOUD_KEY',
    cloudinaryApiSecret: 'CLOUD_SECRET',
  },
  encryption: { enabled: true, iterations: 100000, secret: 'ENCRYPTION_SECRET' },
  schedule: { type: 'cron', expression: '0 2 * * *' },
  pitr: { enabled: true, walIntervalSeconds: 60, retentionDays: 7 },
  alerts: {
    smtpHost: 'smtp.example',
    smtpPort: 587,
    from: 'ops@example',
    to: ['a@example'],
    smtpPass: 'SMTP_SECRET',
    slackWebhook: 'https://hooks.example/SLACK_SECRET',
    customWebhook: 'https://hook.example/CUSTOM_SECRET',
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
  'CUSTOM_SECRET',
];

const SECRET_FIELDS = [
  'password',
  'accessKeyId',
  'secretAccessKey',
  'cloudinaryApiKey',
  'cloudinaryApiSecret',
  'smtpPass',
  'slackWebhook',
  'customWebhook',
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

  it('collects one resource per configured section', () => {
    writeConfig(FULL_CONFIG);
    const kinds = collectLocalResources(dir)
      .map((r) => r.resource)
      .sort();
    expect(kinds).toEqual([
      'alerts',
      'connection',
      'encryption',
      'pitr',
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

  it('represents alert secrets as presence flags', () => {
    writeConfig(FULL_CONFIG);
    const alerts = collectLocalResources(dir).find(
      (r) => r.resource === 'alerts',
    );
    expect(alerts?.data).toMatchObject({
      smtpHost: 'smtp.example',
      from: 'ops@example',
      hasSmtpAuth: true,
      hasSlackWebhook: true,
      hasCustomWebhook: true,
    });
  });

  it('omits optional sections that are absent', () => {
    writeConfig({
      postgres: { host: 'h', port: 5432, user: 'u', database: 'd' },
      storage: { provider: 'local', bucket: 'b' },
      encryption: { enabled: false },
      pitr: { enabled: false, retentionDays: 1 },
    });
    const kinds = collectLocalResources(dir)
      .map((r) => r.resource)
      .sort();
    expect(kinds).toEqual(['connection', 'encryption', 'pitr', 'storage']);
  });
});
