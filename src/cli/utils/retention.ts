import {
  IStorageAdapter,
  StorageObject,
} from '../../storage/storage.interface';
import { logger } from './logger';

export interface RetentionConfig {
  enabled: boolean;
  maxBackups?: number;
  maxAgeDays?: number;
  minBackups?: number;
  runAfterBackup?: boolean;
}

export interface RetentionStats {
  totalBackups: number;
  keptBackups: number;
  deletedBackups: number;
  spaceReclaimed: number;
  errors: string[];
}

export interface BackupInfo {
  key: string;
  size: number;
  lastModified: Date;
  shouldDelete: boolean;
  reason?: string;
}

export async function evaluateRetention(
  adapter: IStorageAdapter,
  config: RetentionConfig,
  storageProvider: string,
): Promise<BackupInfo[]> {
  let prefix: string;
  if (storageProvider === 'local') {
    prefix = 'backup-';
  } else if (storageProvider === 'cloudinary') {
    prefix = 'backup-';
  } else {
    prefix = 'dbdock_backups/backup-';
  }

  const objects = await adapter.listObjects({ prefix });
  const backups = objects
    .filter((obj) => obj.key.includes('backup-'))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

  const minBackups = config.minBackups || 5;
  const cutoffDate = config.maxAgeDays
    ? new Date(Date.now() - config.maxAgeDays * 24 * 60 * 60 * 1000)
    : null;

  const backupInfo: BackupInfo[] = backups.map((backup, index) => {
    const info: BackupInfo = {
      key: backup.key,
      size: backup.size,
      lastModified: backup.lastModified,
      shouldDelete: false,
    };

    if (index < minBackups) {
      info.shouldDelete = false;
      info.reason = `Within minimum ${minBackups} backups to keep`;
      return info;
    }

    if (config.maxBackups && index >= config.maxBackups) {
      info.shouldDelete = true;
      info.reason = `Exceeds maximum ${config.maxBackups} backups`;
      return info;
    }

    if (cutoffDate && backup.lastModified < cutoffDate) {
      info.shouldDelete = true;
      info.reason = `Older than ${config.maxAgeDays} days`;
      return info;
    }

    info.shouldDelete = false;
    info.reason = 'Within retention policy';
    return info;
  });

  return backupInfo;
}

export async function applyRetention(
  adapter: IStorageAdapter,
  config: RetentionConfig,
  storageProvider: string,
  dryRun: boolean = false,
): Promise<RetentionStats> {
  const stats: RetentionStats = {
    totalBackups: 0,
    keptBackups: 0,
    deletedBackups: 0,
    spaceReclaimed: 0,
    errors: [],
  };

  try {
    const backupInfo = await evaluateRetention(
      adapter,
      config,
      storageProvider,
    );
    stats.totalBackups = backupInfo.length;

    const toDelete = backupInfo.filter((b) => b.shouldDelete);
    const toKeep = backupInfo.filter((b) => !b.shouldDelete);

    stats.keptBackups = toKeep.length;

    if (dryRun) {
      stats.deletedBackups = toDelete.length;
      stats.spaceReclaimed = toDelete.reduce((sum, b) => sum + b.size, 0);
      return stats;
    }

    for (const backup of toDelete) {
      try {
        await adapter.deleteObject({ key: backup.key });
        stats.deletedBackups++;
        stats.spaceReclaimed += backup.size;
      } catch (err) {
        const errorMsg = `Failed to delete ${backup.key}: ${err instanceof Error ? err.message : String(err)}`;
        stats.errors.push(errorMsg);
        logger.error(errorMsg);
      }
    }
  } catch (err) {
    const errorMsg = `Retention policy failed: ${err instanceof Error ? err.message : String(err)}`;
    stats.errors.push(errorMsg);
    throw new Error(errorMsg);
  }

  return stats;
}

export function getDefaultRetentionConfig(): RetentionConfig {
  return {
    enabled: true,
    maxBackups: 100,
    maxAgeDays: 30,
    minBackups: 5,
    runAfterBackup: true,
  };
}

export function formatRetentionStats(stats: RetentionStats): string {
  const lines: string[] = [];
  lines.push(`Total backups: ${stats.totalBackups}`);
  lines.push(`Kept: ${stats.keptBackups}`);
  lines.push(`Deleted: ${stats.deletedBackups}`);

  if (stats.spaceReclaimed > 0) {
    const mb = (stats.spaceReclaimed / 1024 / 1024).toFixed(2);
    const gb = (stats.spaceReclaimed / 1024 / 1024 / 1024).toFixed(2);
    lines.push(
      `Space reclaimed: ${parseFloat(gb) >= 1 ? `${gb} GB` : `${mb} MB`}`,
    );
  }

  if (stats.errors.length > 0) {
    lines.push(`Errors: ${stats.errors.length}`);
  }

  return lines.join('\n');
}
