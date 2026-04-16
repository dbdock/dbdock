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
    void this.ensureBasePathExists();
  }

  private async ensureBasePathExists(): Promise<void> {
    try {
      await mkdir(this.basePath, { recursive: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create base path: ${msg}`);
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

    return new Promise((resolve, reject) => {
      let finished = false;
      let hasError = false;

      const cleanup = () => {
        if (!finished) {
          finished = true;
          stream.removeAllListeners();
          writeStream.removeAllListeners();
        }
      };

      const handleError = (error: Error) => {
        if (hasError) return;
        hasError = true;
        cleanup();
        this.logger.error(`Failed to upload ${options.key}: ${error.message}`);
        if (!writeStream.destroyed) {
          writeStream.destroy();
        }
        reject(error);
      };

      const handleFinish = async () => {
        if (hasError || finished) return;
        finished = true;
        cleanup();

        try {
          if (options.metadata) {
            await fs.promises.writeFile(
              this.getMetadataPath(options.key),
              JSON.stringify(options.metadata),
              'utf-8',
            );
          }

          this.logger.log(`Uploaded ${options.key} to local storage`);
          resolve({ key: options.key });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      stream.on('error', handleError);
      writeStream.on('error', handleError);
      writeStream.on('finish', () => {
        void handleFinish();
      });
      writeStream.on('close', () => {
        if (!finished && !hasError) {
          this.logger.warn('WriteStream closed without finish event');
          void handleFinish();
        }
      });

      const pipe = stream.pipe(writeStream);

      pipe.on('error', (error) => {
        this.logger.error(`Pipe error: ${error.message}`);
        handleError(error);
      });
    });
  }

  downloadStream(options: DownloadOptions): Promise<Readable> {
    const fullPath = this.getFullPath(options.key);

    if (!fs.existsSync(fullPath)) {
      return Promise.reject(new Error(`Object not found: ${options.key}`));
    }

    return Promise.resolve(fs.createReadStream(fullPath));
  }

  async listObjects(options?: ListOptions): Promise<StorageObject[]> {
    const prefix = options?.prefix || '';
    const maxKeys = options?.maxKeys || 1000;
    const startAfter = options?.startAfter || '';

    const objects: StorageObject[] = [];

    if (!fs.existsSync(this.basePath)) {
      return [];
    }

    await this.walkDirectory(this.basePath, objects, this.basePath, maxKeys);

    let filteredObjects = objects;

    if (prefix) {
      filteredObjects = objects.filter((obj) => obj.key.includes(prefix));
    }

    return filteredObjects
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
      } else {
        const stats = await stat(fullPath);
        const key = path.relative(basePath, fullPath);

        let metadata: Record<string, string> | undefined;
        const metadataPath = `${fullPath}.metadata.json`;

        if (fs.existsSync(metadataPath)) {
          const metadataContent = await fs.promises.readFile(
            metadataPath,
            'utf-8',
          );
          metadata = JSON.parse(metadataContent) as Record<string, string>;
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

  generatePresignedUrl(options: PresignedUrlOptions): Promise<string> {
    const fullPath = this.getFullPath(options.key);
    return Promise.resolve(`file://${fullPath}`);
  }

  objectExists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);
    return Promise.resolve(fs.existsSync(fullPath));
  }
}
