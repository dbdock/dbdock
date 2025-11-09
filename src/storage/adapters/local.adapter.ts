import { Injectable, Logger } from '@nestjs/common';
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
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';

const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);

@Injectable()
export class LocalStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.ensureBasePathExists();
  }

  private async ensureBasePathExists(): Promise<void> {
    try {
      await mkdir(this.basePath, { recursive: true });
    } catch (error) {
      this.logger.error(`Failed to create base path: ${error.message}`);
      throw error;
    }
  }

  private getFullPath(key: string): string {
    return path.join(this.basePath, key);
  }

  private getMetadataPath(key: string): string {
    return `${this.getFullPath(key)}.metadata.json`;
  }

  async uploadStream(
    stream: Readable,
    options: UploadOptions,
  ): Promise<{ key: string; etag?: string }> {
    const fullPath = this.getFullPath(options.key);
    const dir = path.dirname(fullPath);

    await mkdir(dir, { recursive: true });

    const writeStream = fs.createWriteStream(fullPath);

    try {
      await pipeline(stream, writeStream);

      if (options.metadata) {
        await fs.promises.writeFile(
          this.getMetadataPath(options.key),
          JSON.stringify(options.metadata),
          'utf-8',
        );
      }

      this.logger.log(`Uploaded ${options.key} to local storage`);

      return { key: options.key };
    } catch (error) {
      this.logger.error(`Failed to upload ${options.key}: ${error.message}`);
      throw error;
    }
  }

  async downloadStream(options: DownloadOptions): Promise<Readable> {
    const fullPath = this.getFullPath(options.key);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Object not found: ${options.key}`);
    }

    return fs.createReadStream(fullPath);
  }

  async listObjects(options?: ListOptions): Promise<StorageObject[]> {
    const prefix = options?.prefix || '';
    const maxKeys = options?.maxKeys || 1000;
    const startAfter = options?.startAfter || '';

    const objects: StorageObject[] = [];

    const searchPath = prefix
      ? path.join(this.basePath, prefix)
      : this.basePath;

    if (!fs.existsSync(searchPath)) {
      return [];
    }

    await this.walkDirectory(searchPath, objects, this.basePath, maxKeys);

    return objects
      .filter((obj) => obj.key > startAfter)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(0, maxKeys);
  }

  private async walkDirectory(
    dir: string,
    objects: StorageObject[],
    basePath: string,
    maxKeys: number,
  ): Promise<void> {
    if (objects.length >= maxKeys) return;

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (objects.length >= maxKeys) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.walkDirectory(fullPath, objects, basePath, maxKeys);
      } else if (!entry.name.endsWith('.metadata.json')) {
        const stats = await stat(fullPath);
        const key = path.relative(basePath, fullPath);

        let metadata: Record<string, string> | undefined;
        const metadataPath = `${fullPath}.metadata.json`;

        if (fs.existsSync(metadataPath)) {
          const metadataContent = await fs.promises.readFile(
            metadataPath,
            'utf-8',
          );
          metadata = JSON.parse(metadataContent);
        }

        objects.push({
          key,
          size: stats.size,
          lastModified: stats.mtime,
          metadata,
        });
      }
    }
  }

  async deleteObject(options: DeleteOptions): Promise<void> {
    const fullPath = this.getFullPath(options.key);
    const metadataPath = this.getMetadataPath(options.key);

    if (fs.existsSync(fullPath)) {
      await unlink(fullPath);
      this.logger.log(`Deleted ${options.key} from local storage`);
    }

    if (fs.existsSync(metadataPath)) {
      await unlink(metadataPath);
    }
  }

  async generatePresignedUrl(options: PresignedUrlOptions): Promise<string> {
    const fullPath = this.getFullPath(options.key);
    return `file://${fullPath}`;
  }

  async objectExists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);
    return fs.existsSync(fullPath);
  }
}
