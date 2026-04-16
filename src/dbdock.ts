import { NestFactory } from '@nestjs/core';
import { INestApplicationContext, LogLevel } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppModuleWithoutScheduler } from './app-module-without-scheduler';

export interface DBDockOptions {
  logger?: LogLevel[] | false;
  skipScheduler?: boolean;
  timeout?: number;
}

export async function createDBDock(
  options?: DBDockOptions,
): Promise<INestApplicationContext> {
  const defaultLogger: LogLevel[] = ['error', 'warn'];
  const timeout = options?.timeout ?? 30000;
  const skipScheduler = options?.skipScheduler ?? false;

  const moduleToUse = skipScheduler ? AppModuleWithoutScheduler : AppModule;

  const contextPromise = NestFactory.createApplicationContext(moduleToUse, {
    logger: options?.logger ?? defaultLogger,
  });

  if (timeout > 0) {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`DBDock initialization timed out after ${timeout}ms`),
          ),
        timeout,
      );
    });
    return Promise.race([contextPromise, timeoutPromise]);
  }

  return contextPromise;
}

export { AppModule } from './app.module';
export { BackupService } from './backup/backup.service';
export { WalArchiverService } from './wal/wal-archiver.service';
export { RetentionService } from './wal/retention.service';
export * from './backup/backup.types';
