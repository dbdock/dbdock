import { Module } from '@nestjs/common';
import { AlertService } from './alert.service';
import { DBDockConfigModule } from '../config/config.module';

@Module({
  imports: [DBDockConfigModule],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
