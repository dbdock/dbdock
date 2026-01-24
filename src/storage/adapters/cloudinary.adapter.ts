import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
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

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder?: string;
}

@Injectable()
export class CloudinaryStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(CloudinaryStorageAdapter.name);
  private readonly folder: string;

  constructor(config: CloudinaryConfig) {
    this.folder = config.folder || 'dbdock';

    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });

    this.logger.log(`Cloudinary adapter initialized for folder: ${this.folder}`);
  }

  async uploadStream(
    stream: Readable,
    options: UploadOptions,
  ): Promise<{ key: string; etag?: string }> {
    return new Promise((resolve, reject) => {
      const publicId = options.key.replace(/^dbdock_backups\//, '');

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: this.folder,
          public_id: publicId,
          resource_type: 'raw',
          context: options.metadata,
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error) {
            const friendlyMessage = this.getFriendlyError(error);
            this.logger.error(`Failed to upload ${options.key}: ${friendlyMessage}`);
            const cleanError = new Error(friendlyMessage);
            cleanError.name = 'StorageConfigurationError';
            reject(cleanError);
          } else if (result) {
            this.logger.log(`Uploaded ${options.key} to Cloudinary`);
            resolve({
              key: result.public_id,
              etag: result.etag,
            });
          } else {
            reject(new Error('Upload failed with no result'));
          }
        },
      );

      stream.pipe(uploadStream);
    });
  }

  async downloadStream(options: DownloadOptions): Promise<Readable> {
    try {
      const { Readable: NodeReadable } = await import('stream');

      const url = cloudinary.url(options.key, {
        resource_type: 'raw',
        type: 'upload',
      });

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText} (${response.status})`);
      }

      if (!response.body) {
        throw new Error('No response body received from Cloudinary');
      }

      return NodeReadable.fromWeb(response.body as import('stream/web').ReadableStream);
    } catch (error) {
      const friendlyMessage = this.getFriendlyError(error);
      this.logger.error(`Failed to download ${options.key}: ${friendlyMessage}`);
      const cleanError = new Error(friendlyMessage);
      cleanError.name = 'StorageConfigurationError';
      throw cleanError;
    }
  }

  async listObjects(options?: ListOptions): Promise<StorageObject[]> {
    try {
      const searchPrefix = options?.prefix ? `${this.folder}/${options.prefix}` : this.folder;

      const result = await cloudinary.api.resources({
        type: 'upload',
        resource_type: 'raw',
        prefix: searchPrefix,
        max_results: options?.maxKeys || 500,
        next_cursor: options?.startAfter,
      });

      if (!result.resources || result.resources.length === 0) {
        this.logger.warn(`No resources found with prefix: ${searchPrefix}`);
        return [];
      }

      return result.resources.map((resource: any) => ({
        key: resource.public_id,
        size: resource.bytes,
        lastModified: new Date(resource.created_at),
      }));
    } catch (error) {
      const friendlyMessage = this.getFriendlyError(error);
      this.logger.error(`Failed to list objects: ${friendlyMessage}`);
      const cleanError = new Error(friendlyMessage);
      cleanError.name = 'StorageConfigurationError';
      throw cleanError;
    }
  }

  async deleteObject(options: DeleteOptions): Promise<void> {
    try {
      await cloudinary.uploader.destroy(options.key, {
        resource_type: 'raw',
      });

      this.logger.log(`Deleted ${options.key} from Cloudinary`);
    } catch (error) {
      const friendlyMessage = this.getFriendlyError(error);
      this.logger.error(`Failed to delete ${options.key}: ${friendlyMessage}`);
      const cleanError = new Error(friendlyMessage);
      cleanError.name = 'StorageConfigurationError';
      throw cleanError;
    }
  }

  async generatePresignedUrl(options: PresignedUrlOptions): Promise<string> {
    try {
      const url = cloudinary.url(options.key, {
        resource_type: 'raw',
        type: 'upload',
      });

      return url;
    } catch (error) {
      const friendlyMessage = this.getFriendlyError(error);
      this.logger.error(
        `Failed to generate presigned URL for ${options.key}: ${friendlyMessage}`,
      );
      const cleanError = new Error(friendlyMessage);
      cleanError.name = 'StorageConfigurationError';
      throw cleanError;
    }
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await cloudinary.api.resource(key, {
        resource_type: 'raw',
      });
      return true;
    } catch (error) {
      if ((error as any).error?.http_code === 404) {
        return false;
      }
      throw error;
    }
  }

  private getFriendlyError(error: unknown): string {
    const err = error as any;
    const message = err?.message || '';
    const httpCode = err?.error?.http_code;

    if (httpCode === 401 || message.includes('Invalid API key') || message.includes('authentication')) {
      return 'Invalid storage configuration: Authentication failed. Please verify your Cloudinary API key and secret are correct.';
    }

    if (httpCode === 403) {
      return 'Invalid storage configuration: Access denied. Please verify your Cloudinary credentials have the necessary permissions.';
    }

    if (message.includes('cloud_name')) {
      return 'Invalid storage configuration: Cloud name is invalid. Please verify your Cloudinary cloud name is correct.';
    }

    if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      return 'Invalid storage configuration: Could not connect to Cloudinary. Please verify your internet connection and cloud name.';
    }

    return message || 'Unknown storage error occurred';
  }
}
