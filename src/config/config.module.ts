import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DBDockConfigService } from './config.service';
import * as fs from 'fs';
import * as path from 'path';

const envFiles = ['.env'];
const envLocalPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  envFiles.push('.env.local');
}

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFiles,
    }),
  ],
  providers: [DBDockConfigService],
  exports: [DBDockConfigService],
})
export class DBDockConfigModule {}
