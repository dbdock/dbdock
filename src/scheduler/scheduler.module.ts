import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { BackupModule } from '../backup/backup.module';
import { WalModule } from '../wal/wal.module';

@Module({
  imports: [ScheduleModule.forRoot(), BackupModule, WalModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
