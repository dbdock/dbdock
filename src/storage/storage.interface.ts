import { Readable } from 'stream';

export interface UploadOptions {
  key: string;
  metadata?: Record<string, string>;
  contentType?: string;
}

export interface DownloadOptions {
  key: string;
}

export interface ListOptions {
  prefix?: string;
  maxKeys?: number;
  startAfter?: string;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  metadata?: Record<string, string>;
}

export interface DeleteOptions {
  key: string;
}

export interface PresignedUrlOptions {
  key: string;
  expiresIn?: number;
}

export interface IStorageAdapter {
  uploadStream(
    stream: Readable,
    options: UploadOptions,
  ): Promise<{ key: string; etag?: string }>;

  downloadStream(options: DownloadOptions): Promise<Readable>;

  listObjects(options?: ListOptions): Promise<StorageObject[]>;

  deleteObject(options: DeleteOptions): Promise<void>;

  generatePresignedUrl(options: PresignedUrlOptions): Promise<string>;

  objectExists(key: string): Promise<boolean>;
}
