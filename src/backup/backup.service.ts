import { Injectable, Logger } from '@nestjs/common';
import { DBDockConfigService } from '../config/config.service';
import { StorageService } from '../storage/storage.service';
import { CryptoService } from '../crypto/crypto.service';
import { CompressionService } from './compression.service';
import { DBDockLogger } from '../utils/logger';
import { CounterStream, ProgressStream } from '../utils/stream.pipe';
import {
  BackupMetadata,
  BackupOptions,
  BackupResult,
  BackupStatus,
  BackupType,
} from './backup.types';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

@Injectable()
export class BackupService {
  private readonly logger = new DBDockLogger(BackupService.name);

  constructor(
    private configService: DBDockConfigService,
    private storageService: StorageService,
    private cryptoService: CryptoService,
    private compressionService: CompressionService,
  ) {}

  async createBackup(options: BackupOptions = {}): Promise<BackupResult> {
    const backupId = uuidv4();
    const startTime = new Date();

    const metadata: BackupMetadata = {
      id: backupId,
      type: options.type || BackupType.FULL,
      status: BackupStatus.IN_PROGRESS,
      database: this.configService.get('postgres').database,
      startTime,
      storageKey: this.generateStorageKey(backupId, startTime),
      compression: {
        enabled: options.compress !== false,
        algorithm: 'brotli',
      },
    };

    this.logger.logBackupStart(backupId, metadata.type);

    try {
      const pgStream = this.createPgDumpStream(options);
      const streams: Readable[] = [pgStream];

      const counterStream = new CounterStream();
      streams.push(counterStream);

      if (metadata.compression.enabled) {
        const compressStream = this.compressionService.createCompressStream();
        streams.push(compressStream);
      }

      const compressedCounter = new CounterStream();
      streams.push(compressedCounter);

      if (this.cryptoService.isEnabled() && options.encrypt !== false) {
        const { stream: encryptStream, metadata: encryptionMetadata } =
          this.cryptoService.createEncryptStream();
        metadata.encryption = encryptionMetadata;
        streams.push(encryptStream);
      }

      const progressStream = new ProgressStream(1024 * 1024, (bytes) => {
        this.logger.log(
          `Backup ${backupId} progress: ${(bytes / 1024 / 1024).toFixed(2)} MB`,
        );
      });
      streams.push(progressStream);

      const combinedStream = streams.reduce(
        (prev, curr) => prev.pipe(curr as any),
        streams[0],
      ) as Readable;

      const storageAdapter = this.storageService.getAdapter();
      const uploadResult = await storageAdapter.uploadStream(combinedStream, {
        key: metadata.storageKey,
        metadata: {
          backupId: metadata.id,
          type: metadata.type,
          database: metadata.database,
          compression: metadata.compression.algorithm || 'none',
          encrypted: this.cryptoService.isEnabled() ? 'true' : 'false',
        },
      });

      const endTime = new Date();
      metadata.endTime = endTime;
      metadata.duration = endTime.getTime() - startTime.getTime();
      metadata.size = counterStream.getBytesProcessed();
      metadata.compressedSize = compressedCounter.getBytesProcessed();
      metadata.status = BackupStatus.COMPLETED;

      this.logger.logBackupComplete(
        backupId,
        metadata.duration,
        metadata.size,
      );

      await this.saveMetadata(metadata);

      return {
        metadata,
        storageKey: uploadResult.key,
      };
    } catch (error) {
      metadata.status = BackupStatus.FAILED;
      metadata.error = (error as Error).message;
      metadata.endTime = new Date();

      this.logger.logBackupError(backupId, error as Error);

      await this.saveMetadata(metadata);

      throw error;
    }
  }

  private createPgDumpStream(options: BackupOptions): Readable {
    const pgConfig = this.configService.get('postgres');

    const args = [
      '-h',
      pgConfig.host,
      '-p',
      pgConfig.port.toString(),
      '-U',
      pgConfig.user,
      '-d',
      pgConfig.database,
      '--format=custom',
      '--verbose',
    ];

    if (options.schemas && options.schemas.length > 0) {
      options.schemas.forEach((schema) => {
        args.push('-n', schema);
      });
    }

    if (options.tables && options.tables.length > 0) {
      options.tables.forEach((table) => {
        args.push('-t', table);
      });
    }

    const pgDump = spawn('pg_dump', args, {
      env: {
        ...process.env,
        PGPASSWORD: pgConfig.password,
      },
    });

    pgDump.stderr.on('data', (data) => {
      this.logger.log(`pg_dump: ${data.toString()}`);
    });

    pgDump.on('error', (error) => {
      this.logger.error(`pg_dump error: ${error.message}`);
    });

    return pgDump.stdout;
  }

  private generateStorageKey(backupId: string, timestamp: Date): string {
    const database = this.configService.get('postgres').database;
    const dateStr = timestamp.toISOString().split('T')[0];
    const timeStr = timestamp.toISOString().split('T')[1].replace(/:/g, '-').split('.')[0];

    return `backups/${database}/${dateStr}/${backupId}_${timeStr}.backup`;
  }

  private async saveMetadata(metadata: BackupMetadata): Promise<void> {
    const storageAdapter = this.storageService.getAdapter();
    const metadataKey = `${metadata.storageKey}.metadata.json`;

    const metadataStream = Readable.from([JSON.stringify(metadata, null, 2)]);

    await storageAdapter.uploadStream(metadataStream, {
      key: metadataKey,
      contentType: 'application/json',
    });
  }

  async getBackupMetadata(backupId: string): Promise<BackupMetadata | null> {
    const storageAdapter = this.storageService.getAdapter();
    const objects = await storageAdapter.listObjects({
      prefix: 'backups/',
    });

    const metadataObject = objects.find((obj) =>
      obj.key.includes(backupId) && obj.key.endsWith('.metadata.json'),
    );

    if (!metadataObject) {
      return null;
    }

    const stream = await storageAdapter.downloadStream({
      key: metadataObject.key,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    const metadataJson = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(metadataJson);
  }

  async listBackups(): Promise<BackupMetadata[]> {
    const storageAdapter = this.storageService.getAdapter();
    const objects = await storageAdapter.listObjects({
      prefix: 'backups/',
    });

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
      return JSON.parse(metadataJson) as BackupMetadata;
    });

    return Promise.all(metadataPromises);
  }
}
