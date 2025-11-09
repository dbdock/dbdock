import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

class PostgresConfig {
  @IsString()
  host: string;

  @IsNumber()
  @Min(1)
  port: number;

  @IsString()
  user: string;

  @IsString()
  password: string;

  @IsString()
  database: string;
}

export enum StorageProvider {
  S3 = 's3',
  R2 = 'r2',
  LOCAL = 'local',
}

class StorageConfig {
  @IsEnum(StorageProvider)
  provider: StorageProvider;

  @IsString()
  @IsOptional()
  endpoint?: string;

  @IsString()
  bucket: string;

  @IsString()
  @IsOptional()
  accessKeyId?: string;

  @IsString()
  @IsOptional()
  secretAccessKey?: string;

  @IsString()
  @IsOptional()
  localPath?: string;
}

class EncryptionConfig {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @IsOptional()
  secret?: string;

  @IsNumber()
  @IsOptional()
  @Min(10000)
  iterations?: number;
}

export enum ScheduleType {
  CRON = 'cron',
  INTERVAL = 'interval',
}

class ScheduleConfig {
  @IsEnum(ScheduleType)
  type: ScheduleType;

  @IsString()
  expression: string;
}

class PitrConfig {
  @IsBoolean()
  enabled: boolean;

  @IsNumber()
  @IsOptional()
  @Min(1)
  walIntervalSeconds?: number;

  @IsNumber()
  @Min(1)
  retentionDays: number;
}

class AlertsConfig {
  @IsString()
  smtpHost: string;

  @IsNumber()
  @Min(1)
  smtpPort: number;

  @IsString()
  smtpUser: string;

  @IsString()
  smtpPass: string;

  @IsArray()
  @IsString({ each: true })
  to: string[];
}

export class DBDockConfig {
  @ValidateNested()
  @Type(() => PostgresConfig)
  postgres: PostgresConfig;

  @ValidateNested()
  @Type(() => StorageConfig)
  storage: StorageConfig;

  @ValidateNested()
  @Type(() => EncryptionConfig)
  encryption: EncryptionConfig;

  @ValidateNested()
  @Type(() => ScheduleConfig)
  @IsOptional()
  schedule?: ScheduleConfig;

  @ValidateNested()
  @Type(() => PitrConfig)
  pitr: PitrConfig;

  @ValidateNested()
  @Type(() => AlertsConfig)
  @IsOptional()
  alerts?: AlertsConfig;
}
