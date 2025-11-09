import { Injectable } from '@nestjs/common';
import { S3StorageAdapter, S3Config } from './s3.adapter';

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

@Injectable()
export class R2StorageAdapter extends S3StorageAdapter {
  constructor(config: R2Config) {
    const s3Config: S3Config = {
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: false,
    };

    super(s3Config);
  }
}
