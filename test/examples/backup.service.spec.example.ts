import { Test, TestingModule } from '@nestjs/testing';
import { BackupService } from '../../src/backup/backup.service';
import { DBDockConfigService } from '../../src/config/config.service';
import { StorageService } from '../../src/storage/storage.service';
import { CryptoService } from '../../src/crypto/crypto.service';
import { CompressionService } from '../../src/backup/compression.service';
import { BackupStatus, BackupType } from '../../src/backup/backup.types';
import { Readable } from 'stream';
import {
  createMockConfigService,
  createMockStorageAdapter,
  createMockCryptoService,
  createMockCompressionService,
} from '../helpers/test-setup';

jest.mock('child_process');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-backup-id'),
}));

describe('BackupService', () => {
  let service: BackupService;
  let configService: jest.Mocked<DBDockConfigService>;
  let storageService: jest.Mocked<StorageService>;
  let cryptoService: jest.Mocked<CryptoService>;
  let compressionService: jest.Mocked<CompressionService>;
  let mockStorageAdapter: any;

  beforeEach(async () => {
    mockStorageAdapter = createMockStorageAdapter();
    configService = createMockConfigService() as any;
    cryptoService = createMockCryptoService() as any;
    compressionService = createMockCompressionService() as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        {
          provide: DBDockConfigService,
          useValue: configService,
        },
        {
          provide: StorageService,
          useValue: {
            getAdapter: jest.fn().mockReturnValue(mockStorageAdapter),
          },
        },
        {
          provide: CryptoService,
          useValue: cryptoService,
        },
        {
          provide: CompressionService,
          useValue: compressionService,
        },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createBackup', () => {
    it('should create a backup with default options', async () => {
      const { spawn } = require('child_process');
      const mockPgDump = {
        stdout: new Readable({
          read() {
            this.push('pg_dump output');
            this.push(null);
          },
        }),
        stderr: new Readable({
          read() {
            this.push(null);
          },
        }),
        on: jest.fn(),
      };

      spawn.mockReturnValue(mockPgDump);

      const result = await service.createBackup();

      expect(result.metadata.id).toBe('test-backup-id');
      expect(result.metadata.status).toBe(BackupStatus.COMPLETED);
      expect(result.metadata.type).toBe(BackupType.FULL);
      expect(result.metadata.compression.enabled).toBe(true);
      expect(mockStorageAdapter.uploadStream).toHaveBeenCalled();
    });

    it('should create backup without compression when disabled', async () => {
      const { spawn } = require('child_process');
      const mockPgDump = {
        stdout: new Readable({
          read() {
            this.push('pg_dump output');
            this.push(null);
          },
        }),
        stderr: new Readable({
          read() {
            this.push(null);
          },
        }),
        on: jest.fn(),
      };

      spawn.mockReturnValue(mockPgDump);

      const result = await service.createBackup({ compress: false });

      expect(result.metadata.compression.enabled).toBe(false);
      expect(compressionService.createCompressStream).not.toHaveBeenCalled();
    });

    it('should create backup without encryption when disabled', async () => {
      cryptoService.isEnabled.mockReturnValue(false);
      const { spawn } = require('child_process');
      const mockPgDump = {
        stdout: new Readable({
          read() {
            this.push('pg_dump output');
            this.push(null);
          },
        }),
        stderr: new Readable({
          read() {
            this.push(null);
          },
        }),
        on: jest.fn(),
      };

      spawn.mockReturnValue(mockPgDump);

      await service.createBackup({ encrypt: false });

      expect(cryptoService.createEncryptStream).not.toHaveBeenCalled();
    });

    it('should handle pg_dump errors gracefully', async () => {
      const { spawn } = require('child_process');
      const mockPgDump = {
        stdout: new Readable({
          read() {
            this.push(null);
          },
        }),
        stderr: new Readable({
          read() {
            this.push('pg_dump error');
            this.push(null);
          },
        }),
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('pg_dump failed')), 0);
          }
        }),
      };

      spawn.mockReturnValue(mockPgDump);

      await expect(service.createBackup()).rejects.toThrow();
    });

    it('should generate correct storage key format', async () => {
      const { spawn } = require('child_process');
      const mockPgDump = {
        stdout: new Readable({
          read() {
            this.push('pg_dump output');
            this.push(null);
          },
        }),
        stderr: new Readable({
          read() {
            this.push(null);
          },
        }),
        on: jest.fn(),
      };

      spawn.mockReturnValue(mockPgDump);

      const result = await service.createBackup();
      const storageKey = result.metadata.storageKey;

      expect(storageKey).toMatch(/^backups\/test_db\/\d{4}-\d{2}-\d{2}\/test-backup-id_\d{2}-\d{2}-\d{2}\.backup$/);
    });
  });

  describe('listBackups', () => {
    it('should list all backups', async () => {
      const mockMetadata = {
        id: 'backup-1',
        status: BackupStatus.COMPLETED,
        database: 'test_db',
        startTime: new Date(),
      };

      mockStorageAdapter.listObjects.mockResolvedValue([
        { key: 'backups/test_db/2024-01-01/backup-1.metadata.json' },
      ]);

      mockStorageAdapter.downloadStream.mockResolvedValue(
        new Readable({
          read() {
            this.push(JSON.stringify(mockMetadata));
            this.push(null);
          },
        }),
      );

      const backups = await service.listBackups();

      expect(backups).toHaveLength(1);
      expect(backups[0].id).toBe('backup-1');
    });

    it('should return empty array when no backups exist', async () => {
      mockStorageAdapter.listObjects.mockResolvedValue([]);

      const backups = await service.listBackups();

      expect(backups).toHaveLength(0);
    });
  });

  describe('getBackupMetadata', () => {
    it('should retrieve metadata for existing backup', async () => {
      const mockMetadata = {
        id: 'backup-1',
        status: BackupStatus.COMPLETED,
        database: 'test_db',
        startTime: new Date(),
      };

      mockStorageAdapter.listObjects.mockResolvedValue([
        { key: 'backups/test_db/2024-01-01/backup-1.metadata.json' },
      ]);

      mockStorageAdapter.downloadStream.mockResolvedValue(
        new Readable({
          read() {
            this.push(JSON.stringify(mockMetadata));
            this.push(null);
          },
        }),
      );

      const metadata = await service.getBackupMetadata('backup-1');

      expect(metadata).not.toBeNull();
      expect(metadata?.id).toBe('backup-1');
    });

    it('should return null for non-existent backup', async () => {
      mockStorageAdapter.listObjects.mockResolvedValue([]);

      const metadata = await service.getBackupMetadata('non-existent');

      expect(metadata).toBeNull();
    });
  });
});

