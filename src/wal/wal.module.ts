import { Module } from '@nestjs/common';
import { WalArchiverService } from './wal-archiver.service';
import { RetentionService } from './retention.service';
import { StorageModule } from '../storage/storage.module';
import { CryptoModule } from '../crypto/crypto.module';
import { BackupModule } from '../backup/backup.module';

@Module({
  imports: [StorageModule, CryptoModule, BackupModule],
  providers: [WalArchiverService, RetentionService],
  exports: [WalArchiverService, RetentionService],
})
export class WalModule {}
