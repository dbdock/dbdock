export interface RetentionPolicy {
  backupRetentionDays: number;
  walRetentionDays: number;
  minBackupsToKeep: number;
  maxBackupsToKeep?: number;
}

export interface CleanupResult {
  backupsDeleted: number;
  walFilesDeleted: number;
  spaceSaved: number;
  errors: string[];
}

export interface BackupRetentionInfo {
  id: string;
  database: string;
  createdAt: Date;
  size: number;
  shouldDelete: boolean;
  reason?: string;
}
