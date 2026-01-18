import { EncryptionMetadata } from '../crypto/crypto.service';

export enum BackupType {
  FULL = 'full',
  INCREMENTAL = 'incremental',
}

export enum BackupStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface BackupMetadata {
  id: string;
  type: BackupType;
  status: BackupStatus;
  database: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  size?: number;
  formattedSize?: string;
  compressedSize?: number;
  storageKey: string;
  compression: {
    enabled: boolean;
    algorithm?: string;
  };
  encryption?: EncryptionMetadata;
  pgVersion?: string;
  error?: string;
}

export interface BackupOptions {
  type?: BackupType;
  compress?: boolean;
  encrypt?: boolean;
  schemas?: string[];
  tables?: string[];
  format?: 'custom' | 'plain' | 'directory' | 'tar';
}

export interface BackupResult {
  metadata: BackupMetadata;
  storageKey: string;
  downloadUrl?: string;
}
