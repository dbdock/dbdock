import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { CompressionService } from './compression.service';
import { StorageModule } from '../storage/storage.module';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [StorageModule, CryptoModule],
  providers: [BackupService, CompressionService],
  exports: [BackupService],
})
export class BackupModule {}
