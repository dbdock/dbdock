import { Injectable, Logger } from '@nestjs/common';
import { DBDockConfigService } from '../config/config.service';
import { IStorageAdapter } from './storage.interface';
import { LocalStorageAdapter } from './adapters/local.adapter';
import { S3StorageAdapter } from './adapters/s3.adapter';
import { R2StorageAdapter } from './adapters/r2.adapter';
import { StorageProvider } from '../config/config.schema';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private adapter: IStorageAdapter;

  constructor(private configService: DBDockConfigService) {
    this.initializeAdapter();
  }

  private initializeAdapter(): void {
    const storageConfig = this.configService.get('storage');

    switch (storageConfig.provider) {
      case StorageProvider.LOCAL:
        this.adapter = new LocalStorageAdapter(
          storageConfig.localPath || './backups',
        );
        this.logger.log('Initialized local storage adapter');
        break;

      case StorageProvider.S3:
        if (!storageConfig.accessKeyId || !storageConfig.secretAccessKey) {
          throw new Error('S3 credentials are required');
        }
        this.adapter = new S3StorageAdapter({
          endpoint: storageConfig.endpoint,
          bucket: storageConfig.bucket,
          accessKeyId: storageConfig.accessKeyId,
          secretAccessKey: storageConfig.secretAccessKey,
        });
        this.logger.log('Initialized S3 storage adapter');
        break;

      case StorageProvider.R2:
        if (!storageConfig.accessKeyId || !storageConfig.secretAccessKey) {
          throw new Error('R2 credentials are required');
        }
        if (!storageConfig.endpoint) {
          throw new Error('R2 account ID is required in endpoint');
        }
        const accountId = storageConfig.endpoint.split('.')[0];
        this.adapter = new R2StorageAdapter({
          accountId,
          bucket: storageConfig.bucket,
          accessKeyId: storageConfig.accessKeyId,
          secretAccessKey: storageConfig.secretAccessKey,
        });
        this.logger.log('Initialized R2 storage adapter');
        break;

      default:
        throw new Error(`Unknown storage provider: ${storageConfig.provider}`);
    }
  }

  getAdapter(): IStorageAdapter {
    return this.adapter;
  }
}
