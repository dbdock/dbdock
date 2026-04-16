import { Logger as NestLogger } from '@nestjs/common';

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /password['":\s]*['"]?([^'"}\s,]+)/gi,
    replacement: 'password: ********',
  },
  {
    pattern: /secret['":\s]*['"]?([^'"}\s,]+)/gi,
    replacement: 'secret: ********',
  },
  {
    pattern: /accesskey['":\s]*['"]?([^'"}\s,]+)/gi,
    replacement: 'accessKey: ********',
  },
  {
    pattern: /secretkey['":\s]*['"]?([^'"}\s,]+)/gi,
    replacement: 'secretKey: ********',
  },
  {
    pattern: /apikey['":\s]*['"]?([^'"}\s,]+)/gi,
    replacement: 'apiKey: ********',
  },
  {
    pattern: /apisecret['":\s]*['"]?([^'"}\s,]+)/gi,
    replacement: 'apiSecret: ********',
  },
  {
    pattern: /webhook['":\s]*['"]?(https?:\/\/[^'"}\s,]+)/gi,
    replacement: 'webhook: ********',
  },
  { pattern: /PGPASSWORD=([^\s]+)/gi, replacement: 'PGPASSWORD=********' },
  {
    pattern: /Bearer\s+([A-Za-z0-9\-._~+/]+=*)/gi,
    replacement: 'Bearer ********',
  },
  { pattern: /Basic\s+([A-Za-z0-9+/]+=*)/gi, replacement: 'Basic ********' },
];

export function maskCredentials(message: string): string {
  let masked = message;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

export class DBDockLogger extends NestLogger {
  log(message: string, ...optionalParams: unknown[]): void {
    super.log(maskCredentials(message), ...optionalParams);
  }

  error(message: string, ...optionalParams: unknown[]): void {
    super.error(maskCredentials(message), ...optionalParams);
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    super.warn(maskCredentials(message), ...optionalParams);
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    super.debug(maskCredentials(message), ...optionalParams);
  }

  verbose(message: string, ...optionalParams: unknown[]): void {
    super.verbose(maskCredentials(message), ...optionalParams);
  }
  logBackupStart(backupId: string, type: string): void {
    this.log(`Backup started: ${backupId} (type: ${type})`);
  }

  logBackupComplete(backupId: string, duration: number, size: number): void {
    this.log(
      `Backup completed: ${backupId} (duration: ${duration}ms, size: ${this.formatBytes(size)})`,
    );
  }

  logBackupError(backupId: string, error: Error): void {
    this.error(`Backup failed: ${backupId} - ${error.message}`);
  }

  logRestoreStart(backupId: string, targetTime?: string): void {
    const timeInfo = targetTime ? ` to time: ${targetTime}` : '';
    this.log(`Restore started: ${backupId}${timeInfo}`);
  }

  logRestoreComplete(backupId: string, duration: number): void {
    this.log(`Restore completed: ${backupId} (duration: ${duration}ms)`);
  }

  logRestoreError(backupId: string, error: Error): void {
    this.error(`Restore failed: ${backupId} - ${error.message}`);
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
