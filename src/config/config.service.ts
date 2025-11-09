import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DBDockConfig } from './config.schema';
import * as fs from 'fs';
import * as path from 'path';

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

    if (fs.existsSync(configPath)) {
      const configFile = fs.readFileSync(configPath, 'utf-8');
      configData = JSON.parse(configFile);
    } else {
      configData = this.loadFromEnvironment();
    }

    const configInstance = plainToInstance(DBDockConfig, configData);
    const errors = validateSync(configInstance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      const errorMessages = errors
        .map((error) => Object.values(error.constraints || {}).join(', '))
        .join('; ');
      throw new Error(`Configuration validation failed: ${errorMessages}`);
    }

    this.config = configInstance;
  }

  private loadFromEnvironment(): Partial<DBDockConfig> {
    return {
      postgres: {
        host: this.nestConfig.get<string>('DB_HOST', 'localhost'),
        port: this.nestConfig.get<number>('DB_PORT', 5432),
        user: this.nestConfig.get<string>('DB_USER', 'postgres'),
        password: this.nestConfig.get<string>('DB_PASSWORD', ''),
        database: this.nestConfig.get<string>('DB_NAME', 'postgres'),
      },
      storage: {
        provider: this.nestConfig.get<any>('STORAGE_PROVIDER', 'local'),
        bucket: this.nestConfig.get<string>('STORAGE_BUCKET', 'dbdock-backups'),
        endpoint: this.nestConfig.get<string>('STORAGE_ENDPOINT'),
        accessKeyId: this.nestConfig.get<string>('STORAGE_ACCESS_KEY'),
        secretAccessKey: this.nestConfig.get<string>('STORAGE_SECRET_KEY'),
        localPath: this.nestConfig.get<string>(
          'STORAGE_LOCAL_PATH',
          './backups',
        ),
      },
      encryption: {
        enabled: this.nestConfig.get<boolean>('ENCRYPTION_ENABLED', true),
        secret: this.nestConfig.get<string>('ENCRYPTION_SECRET'),
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
    };
  }

  get<K extends keyof DBDockConfig>(key: K): DBDockConfig[K] {
    return this.config[key];
  }

  getConfig(): DBDockConfig {
    return this.config;
  }
}
