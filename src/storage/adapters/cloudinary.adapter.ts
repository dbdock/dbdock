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
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: this.folder,
          public_id: options.key.replace(/\//g, '_'),
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
      const { default: fetch } = await import('node-fetch');

      const url = cloudinary.url(options.key, {
        resource_type: 'raw',
        type: 'upload',
        secure: true,
      });

      this.logger.log(`Downloading from URL: ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText} (${response.status})`);
      }

      return response.body as unknown as Readable;
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
      const result = await cloudinary.api.resources({
        type: 'upload',
        resource_type: 'raw',
        prefix: options?.prefix ? `${this.folder}/${options.prefix}` : this.folder,
        max_results: options?.maxKeys || 500,
        next_cursor: options?.startAfter,
      });

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
      const expiresAt = Math.floor(Date.now() / 1000) + (options.expiresIn || 3600);

      const url = cloudinary.url(options.key, {
        resource_type: 'raw',
        type: 'authenticated',
        sign_url: true,
        expires_at: expiresAt,
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
