import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DBDockConfig, StorageProvider } from './config.schema';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadSecretsFromEnv,
  mergeSecretsIntoConfig,
  hasSecretsInConfig,
  validateSecrets,
  formatMigrationInstructions,
  ENV_VAR_MAPPING,
} from './secrets.validator';
import { checkFilePermissions } from './permissions.checker';
import { applyDbUrlToPostgresConfig, parsePostgresUrlToConfig } from './env-url.helper';

@Injectable()
export class DBDockConfigService {
  private config: DBDockConfig;

  constructor(private nestConfig: NestConfigService) {
    this.loadAndValidateConfig();
  }

  private loadAndValidateConfig(): void {
    const configPath = this.nestConfig.get<string>(
      'DBDOCK_CONFIG_PATH',
      'dbdock.config.json',
    );

    let configData: unknown;
    let configFromFile = false;

    if (fs.existsSync(configPath)) {
      const configFile = fs.readFileSync(configPath, 'utf-8');
      configData = JSON.parse(configFile);
      configFromFile = true;

      this.checkConfigFilePermissions(configPath);
    } else {
      configData = this.loadFromEnvironment();
    }

    configData = this.transformCLIToProgrammatic(configData);

    const envSecrets = loadSecretsFromEnv();
    configData = mergeSecretsIntoConfig(
      configData as Record<string, unknown>,
      envSecrets
    );
    configData = applyDbUrlToPostgresConfig(configData as Record<string, unknown>) as unknown;

    if (configFromFile) {
      this.warnAboutLegacySecrets(configData as Record<string, unknown>);
    }

    const strictMode = process.env.DBDOCK_STRICT_MODE === 'true';
    const secretsValidation = validateSecrets(
      configData as Record<string, unknown>,
      strictMode
    );

    if (!secretsValidation.valid && strictMode) {
      this.handleError(
        `❌ DBDock Security Error:\n\n${secretsValidation.warnings.join('\n')}`
      );
    }

    const configInstance = plainToInstance(DBDockConfig, configData);
    const errors = validateSync(configInstance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      const friendlyErrors = this.formatValidationErrors(errors);
      this.handleError(
        `❌ DBDock Configuration Error:\n\n${friendlyErrors}\n\nPlease check your dbdock.config.json or environment variables.`,
      );
    }

    this.validateStorageProvider(configInstance);

    this.config = configInstance;
  }

  private checkConfigFilePermissions(configPath: string): void {
    try {
      const permResult = checkFilePermissions(configPath);
      if (!permResult.secure) {
        console.warn(
          '\x1b[33m%s\x1b[0m',
          `⚠️  Config file has insecure permissions (${permResult.currentMode}).\n` +
            `   Recommended: ${permResult.recommendedMode}\n` +
            `   Fix with: chmod 600 ${configPath}\n`
        );
      }
    } catch {
    }
  }

  private warnAboutLegacySecrets(configData: Record<string, unknown>): void {
    const secretsInConfig = hasSecretsInConfig(configData);
    if (secretsInConfig.length > 0) {
      console.warn(
        '\x1b[33m%s\x1b[0m',
        formatMigrationInstructions(secretsInConfig)
      );
    }
  }

  /**
   * Transforms CLI config format to programmatic format.
   * Supports both formats for backward compatibility.
   */
  private transformCLIToProgrammatic(configData: any): any {
    // If already in programmatic format, return as-is
    if (configData.postgres && !configData.database) {
      return configData;
    }

    // Detect CLI format
    const isCLIFormat = configData.database || configData.backup;
    
    if (!isCLIFormat) {
      return configData;
    }

    const transformed: any = {};

    // Transform database -> postgres
    if (configData.database) {
      transformed.postgres = {
        host: configData.database.host || 'localhost',
        port: configData.database.port || 5432,
        user: configData.database.username || configData.database.user || 'postgres',
        password: configData.database.password || '',
        database: configData.database.database || 'postgres',
      };
    }

    // Transform storage
    if (configData.storage) {
      transformed.storage = {
        provider: configData.storage.provider || 'local',
      };

      // Handle nested local.path -> flat localPath
      if (configData.storage.local?.path) {
        transformed.storage.localPath = configData.storage.local.path;
        transformed.storage.bucket = 'dbdock-backups'; // Required by schema
      } else if (configData.storage.localPath) {
        transformed.storage.localPath = configData.storage.localPath;
        transformed.storage.bucket = configData.storage.bucket || 'dbdock-backups';
      }

      // Handle S3/R2 nested config
      if (configData.storage.s3) {
        transformed.storage.bucket = configData.storage.s3.bucket;
        transformed.storage.endpoint = configData.storage.s3.endpoint;
        transformed.storage.accessKeyId = configData.storage.s3.accessKeyId;
        transformed.storage.secretAccessKey = configData.storage.s3.secretAccessKey;
      } else if (configData.storage.r2) {
        transformed.storage.bucket = configData.storage.r2.bucket;
        transformed.storage.endpoint = configData.storage.r2.endpoint;
        transformed.storage.accessKeyId = configData.storage.r2.accessKeyId;
        transformed.storage.secretAccessKey = configData.storage.r2.secretAccessKey;
      } else {
        // Copy flat storage properties
        if (configData.storage.bucket) transformed.storage.bucket = configData.storage.bucket;
        if (configData.storage.endpoint) transformed.storage.endpoint = configData.storage.endpoint;
        if (configData.storage.accessKeyId) transformed.storage.accessKeyId = configData.storage.accessKeyId;
        if (configData.storage.secretAccessKey) transformed.storage.secretAccessKey = configData.storage.secretAccessKey;
      }

      // Handle Cloudinary
      if (configData.storage.cloudinary) {
        transformed.storage.cloudinaryCloudName = configData.storage.cloudinary.cloudName;
        transformed.storage.cloudinaryApiKey = configData.storage.cloudinary.apiKey;
        transformed.storage.cloudinaryApiSecret = configData.storage.cloudinary.apiSecret;
      }
    }

    // Transform backup.encryption -> encryption
    if (configData.backup?.encryption) {
      transformed.encryption = {
        enabled: configData.backup.encryption.enabled || false,
        secret: configData.backup.encryption.key || configData.backup.encryption.secret,
        iterations: 100000,
      };
    } else if (configData.encryption) {
      transformed.encryption = configData.encryption;
    } else {
      // Default encryption config
      transformed.encryption = {
        enabled: false,
        iterations: 100000,
      };
    }

    // Transform backup.schedules -> schedule (take first schedule if exists)
    if (configData.backup?.schedules && configData.backup.schedules.length > 0) {
      const firstSchedule = configData.backup.schedules[0];
      transformed.schedule = {
        type: 'cron',
        expression: firstSchedule.cron,
      };
    } else if (configData.schedule) {
      transformed.schedule = configData.schedule;
    }

    // Add default PITR config
    transformed.pitr = configData.pitr || {
      enabled: false,
      retentionDays: 30,
    };

    // Transform alerts
    if (configData.alerts?.email || configData.alerts?.slack) {
      transformed.alerts = {};
      
      if (configData.alerts.email) {
        transformed.alerts.smtpHost = configData.alerts.email.smtp.host;
        transformed.alerts.smtpPort = configData.alerts.email.smtp.port;
        transformed.alerts.smtpUser = configData.alerts.email.smtp.auth.user;
        transformed.alerts.smtpPass = configData.alerts.email.smtp.auth.pass;
        transformed.alerts.from = configData.alerts.email.from;
        transformed.alerts.to = configData.alerts.email.to;
      }

      if (configData.alerts.slack) {
        transformed.alerts.slackWebhook = configData.alerts.slack.webhookUrl;
      }

      if (configData.alerts.webhook) {
        transformed.alerts.customWebhook = configData.alerts.webhook.url || configData.alerts.webhook;
      }
    } else if (configData.alerts) {
      transformed.alerts = configData.alerts;
    }

    return transformed;
  }

  private loadFromEnvironment(): Partial<DBDockConfig> {
    const dbUrl = this.nestConfig.get<string>('DBDOCK_DB_URL') ||
      this.nestConfig.get<string>('DATABASE_URL');
    let postgres: DBDockConfig['postgres'];
    if (dbUrl) {
      const parsed = parsePostgresUrlToConfig(dbUrl);
      postgres = {
        host: parsed.host,
        port: parsed.port,
        user: parsed.user,
        password: parsed.password,
        database: parsed.database,
      };
    } else {
      postgres = {
        host: this.nestConfig.get<string>('DB_HOST', 'localhost'),
        port: this.nestConfig.get<number>('DB_PORT', 5432),
        user: this.nestConfig.get<string>('DB_USER', 'postgres'),
        password: this.nestConfig.get<string>('DBDOCK_DB_PASSWORD') ||
          this.nestConfig.get<string>('DB_PASSWORD', ''),
        database: this.nestConfig.get<string>('DB_NAME', 'postgres'),
      };
    }
    return {
      postgres,
      storage: {
        provider: this.nestConfig.get<StorageProvider>('STORAGE_PROVIDER', StorageProvider.LOCAL),
        bucket: this.nestConfig.get<string>('STORAGE_BUCKET', 'dbdock-backups'),
        endpoint: this.nestConfig.get<string>('STORAGE_ENDPOINT'),
        accessKeyId: this.nestConfig.get<string>('DBDOCK_STORAGE_ACCESS_KEY') ||
          this.nestConfig.get<string>('STORAGE_ACCESS_KEY'),
        secretAccessKey: this.nestConfig.get<string>('DBDOCK_STORAGE_SECRET_KEY') ||
          this.nestConfig.get<string>('STORAGE_SECRET_KEY'),
        localPath: this.nestConfig.get<string>(
          'STORAGE_LOCAL_PATH',
          './backups',
        ),
        cloudinaryCloudName: this.nestConfig.get<string>('CLOUDINARY_CLOUD_NAME'),
        cloudinaryApiKey: this.nestConfig.get<string>('DBDOCK_CLOUDINARY_API_KEY') ||
          this.nestConfig.get<string>('CLOUDINARY_API_KEY'),
        cloudinaryApiSecret: this.nestConfig.get<string>('DBDOCK_CLOUDINARY_API_SECRET') ||
          this.nestConfig.get<string>('CLOUDINARY_API_SECRET'),
      },
      encryption: {
        enabled: this.nestConfig.get<boolean>('ENCRYPTION_ENABLED', true),
        secret: this.nestConfig.get<string>('DBDOCK_ENCRYPTION_SECRET') ||
          this.nestConfig.get<string>('ENCRYPTION_SECRET'),
        iterations: this.nestConfig.get<number>('ENCRYPTION_ITERATIONS', 100000),
      },
      pitr: {
        enabled: this.nestConfig.get<boolean>('PITR_ENABLED', false),
        walIntervalSeconds: this.nestConfig.get<number>(
          'PITR_WAL_INTERVAL',
          300,
        ),
        retentionDays: this.nestConfig.get<number>('PITR_RETENTION_DAYS', 30),
      },
      alerts: {
        smtpHost: this.nestConfig.get<string>('SMTP_HOST'),
        smtpPort: this.nestConfig.get<number>('SMTP_PORT'),
        smtpUser: this.nestConfig.get<string>('DBDOCK_SMTP_USER') ||
          this.nestConfig.get<string>('SMTP_USER'),
        smtpPass: this.nestConfig.get<string>('DBDOCK_SMTP_PASS') ||
          this.nestConfig.get<string>('SMTP_PASS'),
        from: this.nestConfig.get<string>('SMTP_FROM'),
        to: this.nestConfig.get<string>('ALERT_EMAILS')?.split(','),
        slackWebhook: this.nestConfig.get<string>('DBDOCK_SLACK_WEBHOOK') ||
          this.nestConfig.get<string>('SLACK_WEBHOOK'),
        customWebhook: this.nestConfig.get<string>('DBDOCK_CUSTOM_WEBHOOK'),
      },
    };
  }

  get<K extends keyof DBDockConfig>(key: K): DBDockConfig[K] {
    return this.config[key];
  }

  getConfig(): DBDockConfig {
    return this.config;
  }

  private formatValidationErrors(errors: any[]): string {
    const fieldErrors: string[] = [];
    const suggestions: string[] = [];

    // Check for common config structure mistakes
    const errorProps = errors.map(e => e.property);
    
    if (errorProps.includes('database')) {
      suggestions.push(`\n💡 It looks like you're using 'database' as a top-level property. The correct structure is 'postgres' instead.`);
      suggestions.push(`   Example: { "postgres": { "host": "...", "port": 5432, "user": "...", "password": "...", "database": "..." } }`);
    }
    
    if (errorProps.includes('backup')) {
      suggestions.push(`\n💡 The 'backup' property doesn't exist. Configuration is split into 'storage', 'encryption', 'schedule', and 'pitr' sections.`);
    }

    errors.forEach((error) => {
      const field = error.property;
      const constraints = error.constraints || {};
      const value = error.value;
      
      // Handle top-level property errors
      if (Object.keys(constraints).length > 0) {
        Object.entries(constraints).forEach(([key, msg]: [string, any]) => {
          if (key === 'whitelistValidation' && msg.includes('should not exist')) {
            // Unknown property at root level
            if (field === 'database') {
              fieldErrors.push(`  ✗ '${field}': Should be 'postgres' instead`);
            } else if (field === 'backup') {
              fieldErrors.push(`  ✗ '${field}': Not a valid config section (use 'storage', 'encryption', 'schedule', 'pitr' instead)`);
            } else if (['host', 'port', 'user', 'password'].includes(field)) {
              fieldErrors.push(`  ✗ '${field}': Should be nested under 'postgres.${field}'`);
            } else if (['bucket', 'accessKeyId', 'secretAccessKey', 'endpoint', 'localPath'].includes(field)) {
              fieldErrors.push(`  ✗ '${field}': Should be nested under 'storage.${field}'`);
            } else {
              fieldErrors.push(`  ✗ '${field}': Unknown property`);
            }
          } else {
            // Other validation errors (type, required, etc.)
            fieldErrors.push(`  ✗ ${field}: ${msg}`);
          }
        });
      }

      // Handle nested property errors (children)
      if (error.children && error.children.length > 0) {
        error.children.forEach((child: any) => {
          const childField = `${field}.${child.property}`;
          const childConstraints = child.constraints || {};
          const childValue = child.value;

          if (Object.keys(childConstraints).length > 0) {
            Object.entries(childConstraints).forEach(([key, msg]: [string, any]) => {
              if (key === 'whitelistValidation' && msg.includes('should not exist')) {
                // Unknown nested property
                if (field === 'storage' && child.property === 'local') {
                  fieldErrors.push(`  ✗ ${childField}: Should be 'storage.localPath' (flat string) not 'storage.local.path' (nested object)`);
                } else if (field === 'postgres' && child.property === 'username') {
                  fieldErrors.push(`  ✗ ${childField}: Should be 'postgres.user' instead of 'postgres.username'`);
                } else {
                  fieldErrors.push(`  ✗ ${childField}: Unknown property`);
                }
              } else {
                // Show the actual value if it's helpful
                const valueHint = childValue !== undefined && typeof childValue !== 'object' 
                  ? ` (got: ${JSON.stringify(childValue)})` 
                  : '';
                fieldErrors.push(`  ✗ ${childField}: ${msg}${valueHint}`);
              }
            });
          }
        });
      }
    });

    return [...fieldErrors, ...suggestions].join('\n');
  }

  private validateStorageProvider(config: DBDockConfig): void {
    const { provider, accessKeyId, secretAccessKey, endpoint, localPath, cloudinaryCloudName, cloudinaryApiKey, cloudinaryApiSecret } =
      config.storage;

    if (
      (provider === 's3' || provider === 'r2') &&
      (!accessKeyId || !secretAccessKey)
    ) {
      this.handleError(
        `❌ DBDock Configuration Error:\n\n  • storage.accessKeyId and storage.secretAccessKey are required for ${provider} provider\n\nPlease check your dbdock.config.json or environment variables.`,
      );
    }

    if (provider === 'cloudinary') {
      if (!cloudinaryApiKey || !cloudinaryApiSecret) {
        this.handleError(
          `❌ DBDock Configuration Error:\n\n  • storage.cloudinaryApiKey and storage.cloudinaryApiSecret are required for cloudinary provider\n\nSet via DBDOCK_CLOUDINARY_API_KEY and DBDOCK_CLOUDINARY_API_SECRET environment variables.`,
        );
      }
      if (!cloudinaryCloudName) {
        this.handleError(
          `❌ DBDock Configuration Error:\n\n  • storage.cloudinaryCloudName is required for cloudinary provider\n\nPlease check your dbdock.config.json or environment variables.`,
        );
      }
    }

    if ((provider === 's3' || provider === 'r2') && !endpoint) {
      this.handleError(
        `❌ DBDock Configuration Error:\n\n  • storage.endpoint is required for ${provider} provider\n\nPlease check your dbdock.config.json or environment variables.`,
      );
    }

    if (provider === 'local' && !localPath) {
      this.handleError(
        `❌ DBDock Configuration Error:\n\n  • storage.localPath is required for local provider\n\nPlease check your dbdock.config.json or environment variables.`,
      );
    }

    if (config.encryption.enabled && !config.encryption.secret) {
      this.handleError(
        `❌ DBDock Configuration Error:\n\n  • encryption.secret is required when encryption is enabled\n\nPlease check your dbdock.config.json or environment variables.`,
      );
    }
  }

  private handleError(message: string): void {
    if (process.env.NODE_ENV === 'test' || process.env.DBDOCK_LIBRARY_MODE === 'true') {
      throw new Error(message);
    }
    console.error('\x1b[31m%s\x1b[0m', message);
    process.exit(1);
  }
}
