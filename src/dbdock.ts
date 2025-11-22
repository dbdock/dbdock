import { NestFactory } from '@nestjs/core';
import { INestApplicationContext, LogLevel } from '@nestjs/common';
import { AppModule } from './app.module';

export interface DBDockOptions {
  logger?: LogLevel[] | false;
}

export async function createDBDock(
  options?: DBDockOptions,
): Promise<INestApplicationContext> {
  const defaultLogger: LogLevel[] = ['error', 'warn'];

  return NestFactory.createApplicationContext(AppModule, {
    logger: options?.logger ?? defaultLogger,
  });
}

export { AppModule } from './app.module';
export { BackupService } from './backup/backup.service';
export { WalArchiverService } from './wal/wal-archiver.service';
export { RetentionService } from './wal/retention.service';
export * from './backup/backup.types';
