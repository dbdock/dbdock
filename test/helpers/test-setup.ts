import { Test, TestingModule } from '@nestjs/testing';
import { DBDockConfigService } from '../../src/config/config.service';
import { StorageService } from '../../src/storage/storage.service';
import { CryptoService } from '../../src/crypto/crypto.service';
import { CompressionService } from '../../src/backup/compression.service';
import { BackupService } from '../../src/backup/backup.service';
import { AppModule } from '../../src/app.module';
import { Readable } from 'stream';

export async function createTestModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [AppModule],
  }).compile();
}

export function createMockConfigService(overrides?: any) {
  return {
    get: jest.fn((key: string) => {
      const config = {
        postgres: {
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          password: 'test-password',
          database: 'test_db',
          ...overrides?.postgres,
        },
        storage: {
          provider: 'local',
          bucket: 'test-backups',
          localPath: './test-backups',
          ...overrides?.storage,
        },
        encryption: {
          enabled: true,
          secret: 'test-secret-key-32-chars-long!!',
          iterations: 100000,
          ...overrides?.encryption,
        },
        pitr: {
          enabled: false,
          retentionDays: 30,
          ...overrides?.pitr,
        },
      };
      return config[key] || config;
    }),
  };
}

export function createMockStorageAdapter() {
  return {
    uploadStream: jest.fn().mockResolvedValue({ key: 'test-backup-key' }),
    downloadStream: jest.fn().mockResolvedValue(
      new Readable({
        read() {
          this.push('test data');
          this.push(null);
        },
      }),
    ),
    listObjects: jest.fn().mockResolvedValue([]),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    generatePresignedUrl: jest.fn().mockResolvedValue('https://example.com/presigned-url'),
  };
}

export function createMockCryptoService() {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    createEncryptStream: jest.fn().mockReturnValue({
      stream: new Readable({
        read() {
          this.push('encrypted-data');
          this.push(null);
        },
      }),
      metadata: {
        algorithm: 'aes-256-gcm',
        salt: 'test-salt',
        iv: 'test-iv',
      },
    }),
    createDecryptStream: jest.fn().mockReturnValue(
      new Readable({
        read() {
          this.push('decrypted-data');
          this.push(null);
        },
      }),
    ),
  };
}

export function createMockCompressionService() {
  return {
    createCompressStream: jest.fn().mockReturnValue(
      new Readable({
        read() {
          this.push('compressed-data');
          this.push(null);
        },
      }),
    ),
    createDecompressStream: jest.fn().mockReturnValue(
      new Readable({
        read() {
          this.push('decompressed-data');
          this.push(null);
        },
      }),
    ),
  };
}

