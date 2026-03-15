import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const envLocalPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

export const SENSITIVE_FIELDS = [
  'postgres.password',
  'storage.accessKeyId',
  'storage.secretAccessKey',
  'storage.cloudinaryApiKey',
  'storage.cloudinaryApiSecret',
  'encryption.secret',
  'alerts.smtpUser',
  'alerts.smtpPass',
  'alerts.slackWebhook',
  'alerts.customWebhook',
] as const;

export const ENV_VAR_MAPPING: Record<string, string> = {
  'postgres.password': 'DBDOCK_DB_PASSWORD',
  'storage.accessKeyId': 'DBDOCK_STORAGE_ACCESS_KEY',
  'storage.secretAccessKey': 'DBDOCK_STORAGE_SECRET_KEY',
  'storage.cloudinaryApiKey': 'DBDOCK_CLOUDINARY_API_KEY',
  'storage.cloudinaryApiSecret': 'DBDOCK_CLOUDINARY_API_SECRET',
  'encryption.secret': 'DBDOCK_ENCRYPTION_SECRET',
  'alerts.smtpUser': 'DBDOCK_SMTP_USER',
  'alerts.smtpPass': 'DBDOCK_SMTP_PASS',
  'alerts.slackWebhook': 'DBDOCK_SLACK_WEBHOOK',
  'alerts.customWebhook': 'DBDOCK_CUSTOM_WEBHOOK',
};

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

export function maskSecretValue(value: string | undefined): string {
  if (!value) return '********';
  if (value.length <= 4) return '****';
  return value.slice(0, 2) + '****' + value.slice(-2);
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

export function hasSecretsInConfig(config: Record<string, unknown>): string[] {
  const foundSecrets: string[] = [];

  for (const field of SENSITIVE_FIELDS) {
    const value = getNestedValue(config, field);
    if (value !== undefined && value !== null && value !== '') {
      foundSecrets.push(field);
    }
  }

  return foundSecrets;
}

export function loadSecretsFromEnv(): Record<string, string | undefined> {
  const secrets: Record<string, string | undefined> = {};

  for (const [fieldPath, envVar] of Object.entries(ENV_VAR_MAPPING)) {
    const value = process.env[envVar];
    if (value !== undefined && value !== '') {
      secrets[fieldPath] = value;
    }
  }

  return secrets;
}

export function mergeSecretsIntoConfig(
  config: Record<string, unknown>,
  secrets: Record<string, string | undefined>
): Record<string, unknown> {
  const merged = JSON.parse(JSON.stringify(config));

  for (const [fieldPath, value] of Object.entries(secrets)) {
    if (value !== undefined) {
      setNestedValue(merged, fieldPath, value);
    }
  }

  return merged;
}

export interface SecretsValidationResult {
  valid: boolean;
  missingSecrets: string[];
  warnings: string[];
  mode: 'strict' | 'legacy';
}

export function validateSecrets(
  config: Record<string, unknown>,
  requireEnvOnly: boolean = false
): SecretsValidationResult {
  const result: SecretsValidationResult = {
    valid: true,
    missingSecrets: [],
    warnings: [],
    mode: requireEnvOnly ? 'strict' : 'legacy',
  };

  const secretsInConfig = hasSecretsInConfig(config);
  const envSecrets = loadSecretsFromEnv();

  if (requireEnvOnly && secretsInConfig.length > 0) {
    result.valid = false;
    result.warnings.push(
      'Strict mode enabled: secrets must be provided via environment variables only.'
    );
    for (const field of secretsInConfig) {
      const envVar = ENV_VAR_MAPPING[field];
      result.warnings.push(`  - ${field} found in config, use ${envVar} instead`);
    }
  } else if (secretsInConfig.length > 0) {
    result.warnings.push(
      '⚠️  Security Warning: Secrets detected in configuration file.'
    );
    result.warnings.push(
      '   Consider moving them to environment variables for better security:'
    );
    for (const field of secretsInConfig) {
      const envVar = ENV_VAR_MAPPING[field];
      result.warnings.push(`     - ${field} → ${envVar}`);
    }
    result.warnings.push('');
    result.warnings.push('   Run "npx dbdock migrate-config" to migrate automatically.');
  }

  const requiredSecrets = getRequiredSecrets(config);
  for (const field of requiredSecrets) {
    const configValue = getNestedValue(config, field);
    const envValue = envSecrets[field];

    if (!configValue && !envValue) {
      result.valid = false;
      const envVar = ENV_VAR_MAPPING[field];
      result.missingSecrets.push(`${field} (set via ${envVar})`);
    }
  }

  return result;
}

function getRequiredSecrets(config: Record<string, unknown>): string[] {
  const required: string[] = [];

  required.push('postgres.password');

  const storageProvider = getNestedValue(config, 'storage.provider') as string;
  if (storageProvider === 's3' || storageProvider === 'r2') {
    required.push('storage.accessKeyId');
    required.push('storage.secretAccessKey');
  } else if (storageProvider === 'cloudinary') {
    required.push('storage.cloudinaryApiKey');
    required.push('storage.cloudinaryApiSecret');
  }

  const encryptionEnabled = getNestedValue(config, 'encryption.enabled') as boolean;
  if (encryptionEnabled) {
    required.push('encryption.secret');
  }

  return required;
}

export function formatMigrationInstructions(secretsInConfig: string[]): string {
  const lines = [
    '',
    '╔════════════════════════════════════════════════════════════════╗',
    '║                    SECURITY RECOMMENDATION                      ║',
    '╠════════════════════════════════════════════════════════════════╣',
    '║  Move these secrets from config file to environment variables: ║',
    '╠════════════════════════════════════════════════════════════════╣',
  ];

  for (const field of secretsInConfig) {
    const envVar = ENV_VAR_MAPPING[field];
    lines.push(`║  ${field.padEnd(25)} → ${envVar.padEnd(30)} ║`);
  }

  lines.push('╠════════════════════════════════════════════════════════════════╣');
  lines.push('║  Run: npx dbdock migrate-config                                ║');
  lines.push('╚════════════════════════════════════════════════════════════════╝');
  lines.push('');

  return lines.join('\n');
}
