import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DBDockConfigService } from '../config/config.service';
import { StorageService } from '../storage/storage.service';
import { CryptoService } from '../crypto/crypto.service';
import { CompressionService } from '../backup/compression.service';
import { DBDockLogger } from '../utils/logger';
import { CounterStream } from '../utils/stream.pipe';
import {
  WalMetadata,
  WalArchiveOptions,
  WalArchiveResult,
  WalStatus,
} from './wal.types';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { createHash } from 'crypto';

@Injectable()
export class WalArchiverService implements OnModuleInit {
  private readonly logger = new DBDockLogger(WalArchiverService.name);
  private pitrEnabled: boolean;

  constructor(
    private configService: DBDockConfigService,
    private storageService: StorageService,
    private cryptoService: CryptoService,
    private compressionService: CompressionService,
  ) {
    const pitrConfig = this.configService.get('pitr');
    this.pitrEnabled = pitrConfig.enabled;
  }

  async onModuleInit() {
    if (this.pitrEnabled) {
      this.logger.log('WAL archiver initialized - PITR enabled');
      await this.setupWalArchiving();
    } else {
      this.logger.log('WAL archiver disabled - PITR not enabled');
    }
  }

  private async setupWalArchiving(): Promise<void> {
    const pgConfig = this.configService.get('postgres');

    this.logger.log(
      `WAL archiving configured for database: ${pgConfig.database}`,
    );
    this.logger.log(
      'Note: Ensure PostgreSQL archive_mode is enabled and archive_command is configured',
    );
  }

  async archiveWalFile(options: WalArchiveOptions): Promise<WalArchiveResult> {
    const { walFile, walPath } = options;

    this.logger.logWalArchive(walFile);

    if (!fs.existsSync(walPath)) {
      throw new Error(`WAL file not found: ${walPath}`);
    }

    const metadata: WalMetadata = {
      fileName: walFile,
      timeline: this.extractTimeline(walFile),
      logSegmentNumber: this.extractLogSegmentNumber(walFile),
      status: WalStatus.ARCHIVING,
      archiveTime: new Date(),
      size: 0,
      storageKey: this.generateWalStorageKey(walFile),
    };

    try {
      const fileStream = fs.createReadStream(walPath);
      const streams: Readable[] = [fileStream];

      const counterStream = new CounterStream();
      streams.push(counterStream);

      const hashStream = this.createHashStream();
      streams.push(hashStream);

      const compressStream = this.compressionService.createCompressStream();
      streams.push(compressStream);

      if (this.cryptoService.isEnabled()) {
        const { stream: encryptStream, metadata: encryptionMetadata } =
          this.cryptoService.createEncryptStream();
        streams.push(encryptStream);
      }

      const combinedStream = streams.reduce(
        (prev, curr) => prev.pipe(curr as any),
        streams[0],
      ) as Readable;

      const storageAdapter = this.storageService.getAdapter();
      await storageAdapter.uploadStream(combinedStream, {
        key: metadata.storageKey,
        metadata: {
          walFile: walFile,
          timeline: metadata.timeline.toString(),
          archiveTime: metadata.archiveTime.toISOString(),
        },
      });

      metadata.size = counterStream.getBytesProcessed();
      metadata.checksum = hashStream.getHash();
      metadata.status = WalStatus.ARCHIVED;

      await this.saveWalMetadata(metadata);

      this.logger.log(
        `WAL file archived: ${walFile} (${metadata.size} bytes)`,
      );

      return {
        success: true,
        fileName: walFile,
        storageKey: metadata.storageKey,
        size: metadata.size,
      };
    } catch (error) {
      metadata.status = WalStatus.FAILED;
      const errorMessage = error instanceof Error ? error.message : String(error);
      metadata.error = errorMessage;

      const cleanError = new Error(errorMessage);
      if (error instanceof Error && error.name) {
        cleanError.name = error.name;
      }

      this.logger.logWalArchiveError(walFile, cleanError);

      await this.saveWalMetadata(metadata);

      throw cleanError;
    }
  }

  private createHashStream(): Readable & { getHash: () => string } {
    const hash = createHash('sha256');
    let hashValue = '';

    const stream = new Readable({
      read() {},
    }) as Readable & { getHash: () => string };

    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      hashValue = hash.digest('hex');
    });

    stream.getHash = () => hashValue;

    return stream;
  }

  private extractTimeline(walFile: string): number {
    const timelineHex = walFile.substring(0, 8);
    return parseInt(timelineHex, 16);
  }

  private extractLogSegmentNumber(walFile: string): string {
    return walFile.substring(8);
  }

  private generateWalStorageKey(walFile: string): string {
    const database = this.configService.get('postgres').database;
    const timeline = this.extractTimeline(walFile);

    return `wal/${database}/timeline-${timeline}/${walFile}.br`;
  }

  private async saveWalMetadata(metadata: WalMetadata): Promise<void> {
    const storageAdapter = this.storageService.getAdapter();
    const metadataKey = `${metadata.storageKey}.metadata.json`;

    const metadataStream = Readable.from([JSON.stringify(metadata, null, 2)]);

    await storageAdapter.uploadStream(metadataStream, {
      key: metadataKey,
      contentType: 'application/json',
    });
  }

  async listWalFiles(timeline?: number): Promise<WalMetadata[]> {
    const storageAdapter = this.storageService.getAdapter();
    const database = this.configService.get('postgres').database;

    const prefix = timeline
      ? `wal/${database}/timeline-${timeline}/`
      : `wal/${database}/`;

    const objects = await storageAdapter.listObjects({ prefix });

    const metadataObjects = objects.filter((obj) =>
      obj.key.endsWith('.metadata.json'),
    );

    const metadataPromises = metadataObjects.map(async (obj) => {
      const stream = await storageAdapter.downloadStream({ key: obj.key });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const metadataJson = Buffer.concat(chunks).toString('utf-8');
      return JSON.parse(metadataJson) as WalMetadata;
    });

    return Promise.all(metadataPromises);
  }

  async getWalFile(walFile: string): Promise<Readable> {
    const storageKey = this.generateWalStorageKey(walFile);
    const storageAdapter = this.storageService.getAdapter();

    let stream = await storageAdapter.downloadStream({ key: storageKey });

    if (this.cryptoService.isEnabled()) {
      const metadata = await this.getWalMetadata(walFile);
      if (metadata && metadata.status === WalStatus.ARCHIVED) {
        const decryptStream = this.cryptoService.createDecryptStream({
          algorithm: 'aes-256-gcm',
          salt: '',
          iv: '',
        });
        stream = stream.pipe(decryptStream);
      }
    }

    const decompressStream = this.compressionService.createDecompressStream();
    stream = stream.pipe(decompressStream);

    return stream;
  }

  private async getWalMetadata(walFile: string): Promise<WalMetadata | null> {
    const storageKey = this.generateWalStorageKey(walFile);
    const metadataKey = `${storageKey}.metadata.json`;

    try {
      const storageAdapter = this.storageService.getAdapter();
      const stream = await storageAdapter.downloadStream({ key: metadataKey });

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }

      const metadataJson = Buffer.concat(chunks).toString('utf-8');
      return JSON.parse(metadataJson) as WalMetadata;
    } catch (error) {
      return null;
    }
  }

  async cleanupOldWalFiles(retentionDays: number): Promise<number> {
    const walFiles = await this.listWalFiles();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    let deletedCount = 0;
    const storageAdapter = this.storageService.getAdapter();

    for (const walFile of walFiles) {
      if (new Date(walFile.archiveTime) < cutoffDate) {
        await storageAdapter.deleteObject({ key: walFile.storageKey });
        await storageAdapter.deleteObject({
          key: `${walFile.storageKey}.metadata.json`,
        });
        deletedCount++;
        this.logger.log(`Deleted old WAL file: ${walFile.fileName}`);
      }
    }

    return deletedCount;
  }
}
