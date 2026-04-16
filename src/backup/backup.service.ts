import { Injectable } from '@nestjs/common';
import { DBDockConfigService } from '../config/config.service';
import { StorageProvider } from '../config/config.schema';
import { StorageService } from '../storage/storage.service';
import { CryptoService } from '../crypto/crypto.service';
import { CompressionService } from './compression.service';
import { AlertService } from '../alerts/alert.service';
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
import { Readable, Transform } from 'stream';
import { formatFileSize } from '../utils/format';
import { hasPgPassEntry } from '../config/pgpass.helper';
import { nanoid } from 'nanoid';

@Injectable()
export class BackupService {
  private readonly logger = new DBDockLogger(BackupService.name);

  constructor(
    private configService: DBDockConfigService,
    private storageService: StorageService,
    private cryptoService: CryptoService,
    private compressionService: CompressionService,
    private alertService: AlertService,
  ) {}

  private generateBackupId(): string {
    return nanoid();
  }

  async createBackup(options: BackupOptions = {}): Promise<BackupResult> {
    const backupId = this.generateBackupId();
    const startTime = new Date();

    const metadata: BackupMetadata = {
      id: backupId,
      type: options.type || BackupType.FULL,
      status: BackupStatus.IN_PROGRESS,
      database: this.configService.get('postgres').database,
      startTime,
      storageKey: this.generateStorageKey(backupId, startTime, options.format),
      compression: {
        enabled: options.compress !== false,
        algorithm: 'brotli',
      },
    };

    this.logger.logBackupStart(backupId, metadata.type);

    let pgDumpProcess: ReturnType<typeof spawn> | null = null;

    try {
      const { stream: pgStream, process: pgProc } =
        this.createPgDumpStream(options);
      pgDumpProcess = pgProc;
      const streams: (Readable | Transform)[] = [pgStream];

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

      const progressStream = new ProgressStream(5 * 1024 * 1024, (bytes) => {
        this.logger.log(
          `Progress: ${(bytes / 1024 / 1024).toFixed(2)} MB processed`,
        );
      });
      streams.push(progressStream);

      let combinedStream: Readable | Transform = streams[0];
      for (let i = 1; i < streams.length; i++) {
        combinedStream = combinedStream.pipe(
          streams[i] as NodeJS.WritableStream,
        ) as Readable | Transform;
      }

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

      this.logger.log('Upload completed, processing metadata...');

      if (pgDumpProcess && !pgDumpProcess.killed) {
        pgDumpProcess.kill('SIGTERM');
      }

      const endTime = new Date();
      metadata.endTime = endTime;
      metadata.duration = endTime.getTime() - startTime.getTime();
      metadata.size = counterStream.getBytesProcessed();
      metadata.formattedSize = formatFileSize(metadata.size);
      metadata.compressedSize = compressedCounter.getBytesProcessed();

      if (metadata.size === 0) {
        throw new Error(
          'Backup failed: pg_dump produced no output. Database may be empty or connection failed.',
        );
      }

      metadata.status = BackupStatus.COMPLETED;

      this.logger.logBackupComplete(backupId, metadata.duration, metadata.size);

      this.logger.log('Saving metadata...');
      await this.saveMetadata(metadata);
      this.logger.log('Metadata saved');

      let downloadUrl: string | undefined;

      try {
        downloadUrl = await storageAdapter.generatePresignedUrl({
          key: uploadResult.key,
          expiresIn: 604800,
        });
        this.logger.log('Download URL (valid for 7 days):');
        this.logger.log(downloadUrl);
      } catch {
        this.logger.warn(
          'Could not generate download URL (local storage or error)',
        );
      }

      await this.alertService.sendBackupSuccessAlert(metadata, downloadUrl);

      return {
        metadata,
        storageKey: uploadResult.key,
        downloadUrl,
      };
    } catch (error) {
      metadata.status = BackupStatus.FAILED;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      metadata.error = errorMessage;
      metadata.endTime = new Date();

      const cleanError = new Error(errorMessage);
      if (error instanceof Error && error.name) {
        cleanError.name = error.name;
      }

      this.logger.logBackupError(backupId, cleanError);

      await this.saveMetadata(metadata);

      await this.alertService.sendBackupFailureAlert(metadata, cleanError);

      throw cleanError;
    }
  }

  private createPgDumpStream(options: BackupOptions): {
    stream: Readable;
    process: ReturnType<typeof spawn>;
  } {
    const pgConfig = this.configService.get('postgres');

    // Default to 'custom' format if not specified
    // Map CLI-style formats to pg_dump flags
    const formatMap: Record<string, string> = {
      custom: 'custom',
      plain: 'plain',
      directory: 'directory',
      tar: 'tar',
    };

    const format = options.format || 'custom';
    const pgFormat = formatMap[format] || 'custom';

    const args = [
      '-h',
      pgConfig.host,
      '-p',
      pgConfig.port.toString(),
      '-U',
      pgConfig.user,
      '-d',
      pgConfig.database,
      `--format=${pgFormat}`,
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

    const usePgPass = hasPgPassEntry(
      pgConfig.host,
      pgConfig.port,
      pgConfig.database,
      pgConfig.user,
    );

    const env: NodeJS.ProcessEnv = { ...process.env };

    if (!usePgPass && pgConfig.password) {
      env.PGPASSWORD = pgConfig.password;
    }

    const pgDump = spawn('pg_dump', args, { env });

    const stderrChunks: Buffer[] = [];
    pgDump.stderr.on('data', (data: Buffer) => {
      stderrChunks.push(data);
    });

    pgDump.on('error', (error) => {
      this.logger.error(`pg_dump spawn error: ${error.message}`);
      pgDump.stdout.destroy(error);
    });

    pgDump.stdout.on('error', (error) => {
      this.logger.error(`pg_dump stdout error: ${error.message}`);
    });

    pgDump.stdout.on('end', () => {
      this.logger.log('pg_dump stdout ended');
    });

    pgDump.on('exit', (code, signal) => {
      this.logger.log(
        `pg_dump exited with code ${code}${signal ? ` and signal ${signal}` : ''}`,
      );

      if (code !== 0) {
        const errorMessage = Buffer.concat(stderrChunks).toString();
        const error = new Error(
          `pg_dump exited with code ${code}${signal ? ` and signal ${signal}` : ''}. ${errorMessage}`,
        );
        this.logger.error(error.message);
      }
    });

    return { stream: pgDump.stdout, process: pgDump };
  }

  private generateStorageKey(
    backupId: string,
    timestamp: Date,
    format: string = 'custom',
  ): string {
    const database = this.configService.get('postgres').database;
    const dateStr = timestamp.toISOString().split('T')[0];
    const timeStr = timestamp
      .toISOString()
      .split('T')[1]
      .replace(/:/g, '-')
      .split('.')[0];

    const extensionMap: Record<string, string> = {
      custom: 'sql', // CLI uses .sql for custom format
      plain: 'sql',
      directory: 'dir',
      tar: 'tar',
    };

    const extension = extensionMap[format] || 'sql';

    const storageConfig = this.configService.get('storage');
    if (storageConfig.provider === StorageProvider.LOCAL) {
      return `${database}/${dateStr}/${backupId}_${timeStr}.${extension}`;
    }

    return `backups/${database}/${dateStr}/${backupId}_${timeStr}.${extension}`;
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
    const storageConfig = this.configService.get('storage');
    const prefix =
      storageConfig.provider === StorageProvider.LOCAL ? '' : 'backups/';

    const objects = await storageAdapter.listObjects({
      prefix,
    });

    const metadataObject = objects.find(
      (obj) => obj.key.includes(backupId) && obj.key.endsWith('.metadata.json'),
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
    return JSON.parse(metadataJson) as BackupMetadata;
  }

  async listBackups(): Promise<BackupMetadata[]> {
    const storageAdapter = this.storageService.getAdapter();
    const storageConfig = this.configService.get('storage');
    const prefix =
      storageConfig.provider === StorageProvider.LOCAL ? '' : 'backups/';

    const objects = await storageAdapter.listObjects({
      prefix,
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
