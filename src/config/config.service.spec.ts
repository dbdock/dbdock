import { ConfigService } from '@nestjs/config';
import { DBDockConfigService } from './config.service';
import * as fs from 'fs';

jest.mock('fs');
jest.mock('@nestjs/config');

describe('DBDockConfigService', () => {
  let service: DBDockConfigService;
  let mockConfigService: jest.Mocked<ConfigService>;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;
  });

  it('should be defined', () => {
    expect(DBDockConfigService).toBeDefined();
  });

  describe('loadAndValidateConfig', () => {
    it('should load config from JSON file when it exists', () => {
      const mockConfig = {
        postgres: {
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          password: 'test',
          database: 'test_db',
        },
        storage: {
          provider: 'local',
          bucket: 'test-backups',
          localPath: './backups',
        },
        encryption: {
          enabled: true,
          secret: 'test-secret-key-32-chars-long!!',
          iterations: 100000,
        },
        pitr: {
          enabled: false,
          retentionDays: 30,
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
      mockConfigService.get.mockReturnValue('dbdock.config.json');

      expect(() => {
        service = new DBDockConfigService(mockConfigService);
      }).not.toThrow();
    });

    it('should load config from environment when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          const env: Record<string, any> = {
            DBDOCK_CONFIG_PATH: 'dbdock.config.json',
            DB_HOST: 'localhost',
            DB_PORT: 5432,
            DB_USER: 'postgres',
            DB_PASSWORD: 'test',
            DB_NAME: 'test_db',
            STORAGE_PROVIDER: 'local',
            STORAGE_BUCKET: 'test-backups',
            STORAGE_LOCAL_PATH: './backups',
            ENCRYPTION_ENABLED: true,
            ENCRYPTION_SECRET: 'test-secret-key-32-chars-long!!',
            ENCRYPTION_ITERATIONS: 100000,
            PITR_ENABLED: false,
            PITR_RETENTION_DAYS: 30,
          };
          return env[key] !== undefined ? env[key] : defaultValue;
        },
      );

      expect(() => {
        service = new DBDockConfigService(mockConfigService);
      }).not.toThrow();
    });
  });

  describe('get', () => {
    it('should return config value', () => {
      const mockConfig = {
        postgres: {
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          password: 'test',
          database: 'test_db',
        },
        storage: {
          provider: 'local',
          bucket: 'test-backups',
          localPath: './backups',
        },
        encryption: {
          enabled: true,
          secret: 'test-secret-key-32-chars-long!!',
          iterations: 100000,
        },
        pitr: {
          enabled: false,
          retentionDays: 30,
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
      mockConfigService.get.mockReturnValue('dbdock.config.json');

      service = new DBDockConfigService(mockConfigService);
      const postgresConfig = service.get('postgres');

      expect(postgresConfig).toBeDefined();
      expect(postgresConfig.host).toBe('localhost');
      expect(postgresConfig.database).toBe('test_db');
    });
  });
});
