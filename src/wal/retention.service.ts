import { Injectable, Logger } from '@nestjs/common';
import { DBDockConfigService } from '../config/config.service';
import { StorageService } from '../storage/storage.service';
import { BackupService } from '../backup/backup.service';
import { WalArchiverService } from './wal-archiver.service';
import {
  RetentionPolicy,
  CleanupResult,
  BackupRetentionInfo,
} from './retention.types';
import { BackupMetadata, BackupStatus } from '../backup/backup.types';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private configService: DBDockConfigService,
    private storageService: StorageService,
    private backupService: BackupService,
    private walArchiverService: WalArchiverService,
  ) {}

  getDefaultRetentionPolicy(): RetentionPolicy {
    const pitrConfig = this.configService.get('pitr');

    return {
      backupRetentionDays: pitrConfig.retentionDays || 30,
      walRetentionDays: pitrConfig.retentionDays || 30,
      minBackupsToKeep: 3,
      maxBackupsToKeep: undefined,
    };
  }

  async applyRetentionPolicy(policy?: RetentionPolicy): Promise<CleanupResult> {
    const retentionPolicy = policy || this.getDefaultRetentionPolicy();

    this.logger.log('Starting retention policy enforcement');
    this.logger.log(
      `Backup retention: ${retentionPolicy.backupRetentionDays} days`,
    );
    this.logger.log(`WAL retention: ${retentionPolicy.walRetentionDays} days`);
    this.logger.log(`Min backups to keep: ${retentionPolicy.minBackupsToKeep}`);

    const result: CleanupResult = {
      backupsDeleted: 0,
      walFilesDeleted: 0,
      spaceSaved: 0,
      errors: [],
    };

    try {
      const backupsDeleted = await this.cleanupOldBackups(retentionPolicy);
      result.backupsDeleted = backupsDeleted.count;
      result.spaceSaved += backupsDeleted.spaceSaved;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error cleaning up backups: ${msg}`);
      result.errors.push(`Backup cleanup: ${msg}`);
    }

    try {
      const walFilesDeleted = await this.walArchiverService.cleanupOldWalFiles(
        retentionPolicy.walRetentionDays,
      );
      result.walFilesDeleted = walFilesDeleted;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error cleaning up WAL files: ${msg}`);
      result.errors.push(`WAL cleanup: ${msg}`);
    }

    this.logger.log(
      `Retention policy complete: ${result.backupsDeleted} backups, ${result.walFilesDeleted} WAL files deleted`,
    );

    return result;
  }

  private async cleanupOldBackups(
    policy: RetentionPolicy,
  ): Promise<{ count: number; spaceSaved: number }> {
    const allBackups = await this.backupService.listBackups();

    const completedBackups = allBackups
      .filter((b) => b.status === BackupStatus.COMPLETED)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    const retentionInfo = this.evaluateBackupRetention(
      completedBackups,
      policy,
    );

    const backupsToDelete = retentionInfo.filter((info) => info.shouldDelete);

    let deletedCount = 0;
    let spaceSaved = 0;
    const storageAdapter = this.storageService.getAdapter();

    for (const backupInfo of backupsToDelete) {
      try {
        const backup = completedBackups.find((b) => b.id === backupInfo.id);
        if (!backup) continue;

        await storageAdapter.deleteObject({ key: backup.storageKey });
        await storageAdapter.deleteObject({
          key: `${backup.storageKey}.metadata.json`,
        });

        deletedCount++;
        spaceSaved += backupInfo.size;

        this.logger.log(`Deleted backup: ${backup.id} (${backupInfo.reason})`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to delete backup ${backupInfo.id}: ${msg}`);
      }
    }

    return { count: deletedCount, spaceSaved };
  }

  private evaluateBackupRetention(
    backups: BackupMetadata[],
    policy: RetentionPolicy,
  ): BackupRetentionInfo[] {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.backupRetentionDays);

    return backups.map((backup, index) => {
      const backupDate = new Date(backup.startTime);
      const info: BackupRetentionInfo = {
        id: backup.id,
        database: backup.database,
        createdAt: backupDate,
        size: backup.compressedSize || backup.size || 0,
        shouldDelete: false,
      };

      if (index < policy.minBackupsToKeep) {
        info.shouldDelete = false;
        info.reason = 'Within minimum backups to keep';
        return info;
      }

      if (policy.maxBackupsToKeep && index >= policy.maxBackupsToKeep) {
        info.shouldDelete = true;
        info.reason = 'Exceeds maximum backups to keep';
        return info;
      }

      if (backupDate < cutoffDate) {
        info.shouldDelete = true;
        info.reason = `Older than ${policy.backupRetentionDays} days`;
        return info;
      }

      return info;
    });
  }

  async getRetentionReport(): Promise<{
    backups: BackupRetentionInfo[];
    totalBackups: number;
    backupsToDelete: number;
    spaceToReclaim: number;
  }> {
    const policy = this.getDefaultRetentionPolicy();
    const allBackups = await this.backupService.listBackups();

    const completedBackups = allBackups
      .filter((b) => b.status === BackupStatus.COMPLETED)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    const retentionInfo = this.evaluateBackupRetention(
      completedBackups,
      policy,
    );

    const backupsToDelete = retentionInfo.filter((info) => info.shouldDelete);
    const spaceToReclaim = backupsToDelete.reduce(
      (sum, info) => sum + info.size,
      0,
    );

    return {
      backups: retentionInfo,
      totalBackups: completedBackups.length,
      backupsToDelete: backupsToDelete.length,
      spaceToReclaim,
    };
  }
}
