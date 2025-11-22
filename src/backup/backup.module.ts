import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { CompressionService } from './compression.service';
import { StorageModule } from '../storage/storage.module';
import { CryptoModule } from '../crypto/crypto.module';
import { AlertModule } from '../alerts/alert.module';

@Module({
  imports: [StorageModule, CryptoModule, AlertModule],
  providers: [BackupService, CompressionService],
  exports: [BackupService, CompressionService],
})
export class BackupModule {}
