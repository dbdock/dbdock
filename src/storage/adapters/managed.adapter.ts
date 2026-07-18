import { Readable } from 'stream';
import { createReadStream } from 'fs';
import { basename } from 'path';
import {
  IStorageAdapter,
  UploadOptions,
  DownloadOptions,
  ListOptions,
  StorageObject,
  DeleteOptions,
  PresignedUrlOptions,
} from '../storage.interface';
import { ManagedBroker } from '../../cloud/types';

export class ManagedStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedStorageError';
  }
}

export class ManagedStorageAdapter implements IStorageAdapter {
  constructor(private readonly broker: ManagedBroker) {}

  async uploadFile(
    filePath: string,
    size: number,
    filename?: string,
  ): Promise<{ key: string }> {
    const { url, key } = await this.broker.presignUpload({
      filename: filename ?? basename(filePath),
      size,
    });

    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-length': String(size) },
      body: createReadStream(filePath) as unknown as ReadableStream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    if (!res.ok) {
      throw new ManagedStorageError(
        `Upload to DBDock storage failed (HTTP ${res.status}).`,
      );
    }

    return { key };
  }

  uploadStream(
    _stream: Readable,
    _options: UploadOptions,
  ): Promise<{ key: string; etag?: string }> {
    return Promise.reject(
      new ManagedStorageError(
        'DBDock managed storage uploads a completed backup file, not a raw stream.',
      ),
    );
  }

  async downloadStream(options: DownloadOptions): Promise<Readable> {
    const { url } = await this.broker.presignDownload(options.key);
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new ManagedStorageError(
        `Download from DBDock storage failed (HTTP ${res.status}).`,
      );
    }
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  }

  async listObjects(options?: ListOptions): Promise<StorageObject[]> {
    const objects = await this.broker.listManagedObjects();
    const mapped: StorageObject[] = objects.map((o) => ({
      key: o.key,
      size: o.size,
      lastModified: new Date(o.lastModified),
    }));
    const filtered = options?.prefix
      ? mapped.filter((o) => o.key.startsWith(options.prefix as string))
      : mapped;
    return options?.maxKeys ? filtered.slice(0, options.maxKeys) : filtered;
  }

  async deleteObject(options: DeleteOptions): Promise<void> {
    await this.broker.deleteManagedObject(options.key);
  }

  async generatePresignedUrl(options: PresignedUrlOptions): Promise<string> {
    const { url } = await this.broker.presignDownload(options.key);
    return url;
  }

  async objectExists(key: string): Promise<boolean> {
    const objects = await this.broker.listManagedObjects();
    return objects.some((o) => o.key === key);
  }
}
