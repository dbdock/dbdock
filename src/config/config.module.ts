import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DBDockConfigService } from './config.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [DBDockConfigService],
  exports: [DBDockConfigService],
})
export class DBDockConfigModule {}
