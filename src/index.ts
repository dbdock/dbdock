export { AppModule } from './app.module';
export { createDBDock } from './dbdock';

export { BackupService } from './backup/backup.service';
export { BackupModule } from './backup/backup.module';
export { CompressionService } from './backup/compression.service';
export * from './backup/backup.types';

export { DBDockConfigService } from './config/config.service';
export { DBDockConfigModule } from './config/config.module';
export * from './config/config.schema';

export { CryptoService } from './crypto/crypto.service';
export { CryptoModule } from './crypto/crypto.module';

export { StorageService } from './storage/storage.service';
export { StorageModule } from './storage/storage.module';
export * from './storage/storage.interface';
export { LocalStorageAdapter } from './storage/adapters/local.adapter';
export { S3StorageAdapter } from './storage/adapters/s3.adapter';
export { R2StorageAdapter } from './storage/adapters/r2.adapter';

export { WalArchiverService } from './wal/wal-archiver.service';
export { RetentionService } from './wal/retention.service';
export { WalModule } from './wal/wal.module';
export * from './wal/wal.types';
export * from './wal/retention.types';
export { PostgresConfigHelper } from './wal/postgres-config.helper';

export { SchedulerService } from './scheduler/scheduler.service';
export { SchedulerModule } from './scheduler/scheduler.module';

export { DBDockLogger } from './utils/logger';
export { CounterStream, ProgressStream } from './utils/stream.pipe';

export { AlertService } from './alerts/alert.service';
export { AlertModule } from './alerts/alert.module';
export * from './alerts/alert.types';
export { DEFAULT_TEMPLATES } from './alerts/alert-templates';
