import { Logger as NestLogger } from '@nestjs/common';

export class DBDockLogger extends NestLogger {
  logBackupStart(backupId: string, type: string): void {
    this.log(`Backup started: ${backupId} (type: ${type})`);
  }

  logBackupComplete(backupId: string, duration: number, size: number): void {
    this.log(
      `Backup completed: ${backupId} (duration: ${duration}ms, size: ${this.formatBytes(size)})`,
    );
  }

  logBackupError(backupId: string, error: Error): void {
    this.error(`Backup failed: ${backupId} - ${error.message}`, error.stack);
  }

  logRestoreStart(backupId: string, targetTime?: string): void {
    const timeInfo = targetTime ? ` to time: ${targetTime}` : '';
    this.log(`Restore started: ${backupId}${timeInfo}`);
  }

  logRestoreComplete(backupId: string, duration: number): void {
    this.log(`Restore completed: ${backupId} (duration: ${duration}ms)`);
  }

  logRestoreError(backupId: string, error: Error): void {
    this.error(`Restore failed: ${backupId} - ${error.message}`, error.stack);
  }

  logWalArchive(walFile: string): void {
    this.log(`WAL archived: ${walFile}`);
  }

  logWalArchiveError(walFile: string, error: Error): void {
    this.error(`WAL archive failed: ${walFile} - ${error.message}`);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}
