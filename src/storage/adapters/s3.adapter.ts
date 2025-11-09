import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  IStorageAdapter,
  UploadOptions,
  DownloadOptions,
  ListOptions,
  StorageObject,
  DeleteOptions,
  PresignedUrlOptions,
} from '../storage.interface';
import { Readable } from 'stream';

export interface S3Config {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

@Injectable()
export class S3StorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;

    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? false,
    });

    this.logger.log(`S3 adapter initialized for bucket: ${this.bucket}`);
  }

  async uploadStream(
    stream: Readable,
    options: UploadOptions,
  ): Promise<{ key: string; etag?: string }> {
    try {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: options.key,
          Body: stream,
          ContentType: options.contentType,
          Metadata: options.metadata,
        },
      });

      upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded && progress.total) {
          const percent = ((progress.loaded / progress.total) * 100).toFixed(2);
          this.logger.log(`Upload progress for ${options.key}: ${percent}%`);
        }
      });

      const result = await upload.done();

      this.logger.log(`Uploaded ${options.key} to S3`);

      return {
        key: options.key,
        etag: result.ETag,
      };
    } catch (error) {
      this.logger.error(`Failed to upload ${options.key}: ${error.message}`);
      throw error;
    }
  }

  async downloadStream(options: DownloadOptions): Promise<Readable> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: options.key,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error(`No body in response for ${options.key}`);
      }

      return response.Body as Readable;
    } catch (error) {
      this.logger.error(`Failed to download ${options.key}: ${error.message}`);
      throw error;
    }
  }

  async listObjects(options?: ListOptions): Promise<StorageObject[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: options?.prefix,
        MaxKeys: options?.maxKeys || 1000,
        StartAfter: options?.startAfter,
      });

      const response = await this.client.send(command);

      if (!response.Contents) {
        return [];
      }

      return response.Contents.map((obj) => ({
        key: obj.Key!,
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
      }));
    } catch (error) {
      this.logger.error(`Failed to list objects: ${error.message}`);
      throw error;
    }
  }

  async deleteObject(options: DeleteOptions): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: options.key,
      });

      await this.client.send(command);

      this.logger.log(`Deleted ${options.key} from S3`);
    } catch (error) {
      this.logger.error(`Failed to delete ${options.key}: ${error.message}`);
      throw error;
    }
  }

  async generatePresignedUrl(options: PresignedUrlOptions): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: options.key,
      });

      const url = await getSignedUrl(this.client, command, {
        expiresIn: options.expiresIn || 3600,
      });

      return url;
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned URL for ${options.key}: ${error.message}`,
      );
      throw error;
    }
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      if ((error as any).name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }
}
