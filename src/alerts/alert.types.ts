import { BackupMetadata } from '../backup/backup.types';

export enum AlertType {
  BACKUP_SUCCESS = 'backup_success',
  BACKUP_FAILURE = 'backup_failure',
  RETENTION_CLEANUP = 'retention_cleanup',
  STORAGE_ERROR = 'storage_error',
}

export interface AlertTemplate {
  subject: string;
  body: string;
}

export interface AlertContext {
  type: AlertType;
  metadata?: BackupMetadata;
  error?: Error;
  downloadUrl?: string;
  details?: Record<string, any>;
}

export interface EmailOptions {
  to: string[];
  subject: string;
  html: string;
  text?: string;
}
