import { Module } from '@nestjs/common';
import { DBDockConfigModule } from './config/config.module';
import { StorageModule } from './storage/storage.module';
import { CryptoModule } from './crypto/crypto.module';
import { BackupModule } from './backup/backup.module';
import { WalModule } from './wal/wal.module';

@Module({
  imports: [
    DBDockConfigModule,
    StorageModule,
    CryptoModule,
    BackupModule,
    WalModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModuleWithoutScheduler {}
