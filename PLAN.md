# Multi-Database Support Implementation Plan

## Overview
Extend DBDock to support MySQL, MongoDB, SQLite, and Redis in addition to PostgreSQL, with configurable backup formats for each database type.

---

## Phase 1: Architecture Refactoring

### 1.1 Database Provider Abstraction
Create a database provider interface to support multiple database types.

**Files to create:**
- `src/database/database.types.ts` - Database enums, types, and interfaces
- `src/database/database-provider.interface.ts` - Base provider interface
- `src/database/providers/postgres.provider.ts` - PostgreSQL implementation
- `src/database/providers/mysql.provider.ts` - MySQL implementation
- `src/database/providers/mongodb.provider.ts` - MongoDB implementation
- `src/database/providers/sqlite.provider.ts` - SQLite implementation
- `src/database/providers/redis.provider.ts` - Redis implementation
- `src/database/database-provider.factory.ts` - Factory for creating providers
- `src/database/database.module.ts` - Database module

**Key interfaces:**
```typescript
enum DatabaseType {
  POSTGRES = 'postgres',
  MYSQL = 'mysql',
  MONGODB = 'mongodb',
  SQLITE = 'sqlite',
  REDIS = 'redis',
}

enum PostgresBackupFormat {
  CUSTOM = 'custom',
  PLAIN = 'plain',
  TAR = 'tar',
  DIRECTORY = 'directory',
}

enum MySQLBackupFormat {
  SQL = 'sql',
  CSV = 'csv',
}

enum MongoDBBackupFormat {
  BSON = 'bson',
  JSON = 'json',
}

enum RedisBackupFormat {
  RDB = 'rdb',
  AOF = 'aof',
}

interface DatabaseProvider {
  validateConnection(): Promise<boolean>;
  createBackupStream(options: BackupOptions): BackupStreamResult;
  getDefaultFormat(): string;
  getSupportedFormats(): string[];
  supportsPointInTimeRecovery(): boolean;
}

interface BackupStreamResult {
  stream: Readable;
  process?: ChildProcess;
  metadata?: Record<string, unknown>;
}
```

### 1.2 Configuration Schema Updates

**Files to modify:**
- `src/config/config.schema.ts`
- `src/config/config.service.ts`

**Changes:**
```typescript
class DatabaseConfig {
  @IsEnum(DatabaseType)
  type: DatabaseType;

  @ValidateNested()
  @Type(() => PostgresConfig)
  @IsOptional()
  postgres?: PostgresConfig;

  @ValidateNested()
  @Type(() => MySQLConfig)
  @IsOptional()
  mysql?: MySQLConfig;

  @ValidateNested()
  @Type(() => MongoDBConfig)
  @IsOptional()
  mongodb?: MongoDBConfig;

  @ValidateNested()
  @Type(() => SQLiteConfig)
  @IsOptional()
  sqlite?: SQLiteConfig;

  @ValidateNested()
  @Type(() => RedisConfig)
  @IsOptional()
  redis?: RedisConfig;
}

class MySQLConfig {
  @IsString()
  host: string;

  @IsNumber()
  port: number;

  @IsString()
  user: string;

  @IsString()
  password: string;

  @IsString()
  database: string;
}

class MongoDBConfig {
  @IsString()
  uri: string;

  @IsString()
  @IsOptional()
  database?: string;
}

class SQLiteConfig {
  @IsString()
  path: string;
}

class RedisConfig {
  @IsString()
  host: string;

  @IsNumber()
  port: number;

  @IsString()
  @IsOptional()
  password?: string;

  @IsNumber()
  @IsOptional()
  database?: number;
}
```

### 1.3 Backup Types Enhancement

**Files to modify:**
- `src/backup/backup.types.ts`

**Changes:**
```typescript
interface BackupOptions {
  type?: BackupType;
  format?: string;
  compress?: boolean;
  encrypt?: boolean;
  schemas?: string[];
  tables?: string[];
  collections?: string[];
}

interface BackupMetadata {
  id: string;
  type: BackupType;
  status: BackupStatus;
  databaseType: DatabaseType;
  database: string;
  format: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  size?: number;
  compressedSize?: number;
  storageKey: string;
  compression: {
    enabled: boolean;
    algorithm?: string;
  };
  encryption?: EncryptionMetadata;
  version?: string;
  error?: string;
}
```

---

## Phase 2: Database Provider Implementation

### 2.1 PostgreSQL Provider
**File:** `src/database/providers/postgres.provider.ts`

**Implementation:**
- Extract current `createPgDumpStream` logic from `BackupService`
- Add format support: `custom`, `plain`, `tar`, `directory`
- Maintain WAL archiving support
- Connection validation via `pg` client

### 2.2 MySQL Provider
**File:** `src/database/providers/mysql.provider.ts`

**Implementation:**
- Use `mysqldump` CLI tool
- Format support: `sql` (default), `csv`
- Command: `mysqldump --single-transaction --quick --lock-tables=false`
- Optional: Binary log position for PITR
- Connection validation via `mysql2` client

**Dependencies to add:**
```bash
pnpm add mysql2
```

### 2.3 MongoDB Provider
**File:** `src/database/providers/mongodb.provider.ts`

**Implementation:**
- Use `mongodump` CLI tool
- Format support: `bson` (default), `json`
- Command: `mongodump --archive --gzip` (if compression enabled)
- Support for specific collections
- Connection validation via `mongodb` client

**Dependencies to add:**
```bash
pnpm add mongodb
```

### 2.4 SQLite Provider
**File:** `src/database/providers/sqlite.provider.ts`

**Implementation:**
- Use `.backup` command via `sqlite3` CLI
- Alternative: File copy with WAL checkpoint
- Format: Binary database file (default)
- Command: `sqlite3 database.db ".backup -"` for streaming
- Connection validation via `better-sqlite3`

**Dependencies to add:**
```bash
pnpm add better-sqlite3
```

### 2.5 Redis Provider
**File:** `src/database/providers/redis.provider.ts`

**Implementation:**
- Format support: `rdb` (default), `aof`
- RDB: Use `BGSAVE` + read RDB file or `redis-cli --rdb`
- AOF: Stream AOF file if available
- Command: `redis-cli --rdb /dev/stdout`
- Connection validation via `ioredis`

**Dependencies to add:**
```bash
pnpm add ioredis
```

---

## Phase 3: Backup Service Refactoring

### 3.1 Update BackupService
**File:** `src/backup/backup.service.ts`

**Changes:**
- Remove hardcoded `createPgDumpStream` method
- Inject `DatabaseProviderFactory`
- Dynamically select provider based on config
- Update `createBackup` to use provider interface
- Update `generateStorageKey` to include database type
- Validate format against provider's supported formats

**New logic:**
```typescript
async createBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const dbType = this.configService.get('database').type;
  const provider = this.databaseProviderFactory.getProvider(dbType);

  if (options.format) {
    const supportedFormats = provider.getSupportedFormats();
    if (!supportedFormats.includes(options.format)) {
      throw new Error(
        `Format '${options.format}' not supported for ${dbType}. ` +
        `Supported formats: ${supportedFormats.join(', ')}`
      );
    }
  }

  const format = options.format || provider.getDefaultFormat();
  const { stream, process, metadata: providerMetadata } =
    provider.createBackupStream({ ...options, format });

  // Continue with existing compression/encryption pipeline
}
```

### 3.2 Update Storage Key Generation
**Changes:**
```typescript
private generateStorageKey(
  backupId: string,
  timestamp: Date,
  dbType: DatabaseType,
  format: string
): string {
  const dbConfig = this.configService.get('database');
  const database = dbConfig[dbType]?.database ||
                   dbConfig[dbType]?.path ||
                   'default';

  const dateStr = timestamp.toISOString().split('T')[0];
  const timeStr = timestamp
    .toISOString()
    .split('T')[1]
    .replace(/:/g, '-')
    .split('.')[0];

  const extension = this.getFileExtension(dbType, format);

  return `backups/${dbType}/${database}/${dateStr}/${backupId}_${timeStr}.${extension}`;
}

private getFileExtension(dbType: DatabaseType, format: string): string {
  const extensionMap: Record<string, Record<string, string>> = {
    postgres: { custom: 'dump', plain: 'sql', tar: 'tar', directory: 'dir' },
    mysql: { sql: 'sql', csv: 'csv' },
    mongodb: { bson: 'archive', json: 'json' },
    sqlite: { binary: 'db' },
    redis: { rdb: 'rdb', aof: 'aof' },
  };

  return extensionMap[dbType]?.[format] || 'backup';
}
```

---

## Phase 4: PITR Support Per Database

### 4.1 Update PITR Configuration
**File:** `src/config/config.schema.ts`

**Changes:**
```typescript
class PitrConfig {
  @IsBoolean()
  enabled: boolean;

  @IsNumber()
  @Min(1)
  retentionDays: number;

  @IsNumber()
  @IsOptional()
  walIntervalSeconds?: number;

  @IsString()
  @IsOptional()
  mysqlBinlogPath?: string;
}
```

### 4.2 PITR Provider Interface
**File:** `src/database/database-provider.interface.ts`

**Add methods:**
```typescript
interface DatabaseProvider {
  supportsPointInTimeRecovery(): boolean;
  archiveWalFile?(options: WalArchiveOptions): Promise<void>;
  listWalFiles?(): Promise<WalFile[]>;
}
```

**Implementation notes:**
- PostgreSQL: WAL archiving (existing implementation)
- MySQL: Binary log archiving
- MongoDB: Oplog tailing (future enhancement)
- SQLite: Not supported (single file)
- Redis: AOF archiving

---

## Phase 5: Configuration Updates

### 5.1 JSON Config Example
**File:** `dbdock.config.example.json`

**Update:**
```json
{
  "database": {
    "type": "postgres",
    "postgres": {
      "host": "localhost",
      "port": 5432,
      "user": "postgres",
      "password": "password",
      "database": "myapp"
    },
    "mysql": {
      "host": "localhost",
      "port": 3306,
      "user": "root",
      "password": "password",
      "database": "myapp"
    },
    "mongodb": {
      "uri": "mongodb://localhost:27017",
      "database": "myapp"
    },
    "sqlite": {
      "path": "./database.sqlite"
    },
    "redis": {
      "host": "localhost",
      "port": 6379,
      "password": "password",
      "database": 0
    }
  },
  "storage": {
    "provider": "local",
    "bucket": "dbdock-backups",
    "localPath": "./backups"
  },
  "encryption": {
    "enabled": true,
    "secret": "your-32-character-secret-key-here",
    "iterations": 100000
  },
  "pitr": {
    "enabled": false,
    "retentionDays": 30
  }
}
```

### 5.2 Environment Variables
**File:** `.env.example`

**Add:**
```bash
DB_TYPE=postgres

# PostgreSQL
DB_POSTGRES_HOST=localhost
DB_POSTGRES_PORT=5432
DB_POSTGRES_USER=postgres
DB_POSTGRES_PASSWORD=password
DB_POSTGRES_DATABASE=myapp

# MySQL
DB_MYSQL_HOST=localhost
DB_MYSQL_PORT=3306
DB_MYSQL_USER=root
DB_MYSQL_PASSWORD=password
DB_MYSQL_DATABASE=myapp

# MongoDB
DB_MONGODB_URI=mongodb://localhost:27017
DB_MONGODB_DATABASE=myapp

# SQLite
DB_SQLITE_PATH=./database.sqlite

# Redis
DB_REDIS_HOST=localhost
DB_REDIS_PORT=6379
DB_REDIS_PASSWORD=password
DB_REDIS_DATABASE=0
```

---

## Phase 6: Testing Strategy

### 6.1 Unit Tests
**Files to create:**
- `src/database/providers/postgres.provider.spec.ts`
- `src/database/providers/mysql.provider.spec.ts`
- `src/database/providers/mongodb.provider.spec.ts`
- `src/database/providers/sqlite.provider.spec.ts`
- `src/database/providers/redis.provider.spec.ts`
- `src/database/database-provider.factory.spec.ts`

### 6.2 Integration Tests
**Files to create:**
- `test/integration/postgres-backup.spec.ts`
- `test/integration/mysql-backup.spec.ts`
- `test/integration/mongodb-backup.spec.ts`
- `test/integration/sqlite-backup.spec.ts`
- `test/integration/redis-backup.spec.ts`

**Use Docker Compose for test databases:**
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: test
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: test
  mongodb:
    image: mongo:7
  redis:
    image: redis:7
```

### 6.3 Format Testing
Test each database with all supported formats to ensure:
- Backup stream works correctly
- Compression works with each format
- Encryption works with each format
- Restore validation (future enhancement)

---

## Phase 7: Documentation Updates

### 7.1 README.md
**Updates needed:**
- Change "PostgreSQL backup" to "Multi-database backup"
- Add database support matrix
- Update quick start for each database
- Add format selection examples
- Update badges for each database

### 7.2 CONFIGURATION.md
**Updates needed:**
- Document database type selection
- Document format options per database
- Add configuration examples for each database
- Document PITR support per database

### 7.3 New Documentation
**Files to create:**
- `docs/DATABASE_SUPPORT.md` - Complete database support guide
- `docs/FORMAT_GUIDE.md` - Backup format selection guide
- `docs/MYSQL_SETUP.md` - MySQL-specific setup
- `docs/MONGODB_SETUP.md` - MongoDB-specific setup
- `docs/SQLITE_SETUP.md` - SQLite-specific setup
- `docs/REDIS_SETUP.md` - Redis-specific setup

---

## Phase 8: Migration Guide

### 8.1 Breaking Changes
**File:** `MIGRATION.md`

Document migration from current version:
```markdown
# Migration Guide

## From v1.x to v2.x

### Configuration Changes

**Before:**
```json
{
  "postgres": {
    "host": "localhost",
    ...
  }
}
```

**After:**
```json
{
  "database": {
    "type": "postgres",
    "postgres": {
      "host": "localhost",
      ...
    }
  }
}
```

### API Changes

**Before:**
```typescript
await backupService.createBackup({
  compress: true,
  encrypt: true,
});
```

**After:**
```typescript
await backupService.createBackup({
  format: 'custom',
  compress: true,
  encrypt: true,
});
```
```

---

## Phase 9: Package Dependencies

### 9.1 Required CLI Tools
Document required system dependencies:

**PostgreSQL:**
- `pg_dump` (already required)

**MySQL:**
- `mysqldump` (from MySQL client)

**MongoDB:**
- `mongodump` (from MongoDB Database Tools)

**SQLite:**
- `sqlite3` (system package)

**Redis:**
- `redis-cli` (from Redis)

### 9.2 Node.js Dependencies
```json
{
  "dependencies": {
    "mysql2": "^3.6.5",
    "mongodb": "^6.3.0",
    "better-sqlite3": "^9.2.2",
    "ioredis": "^5.3.2"
  },
  "peerDependencies": {
    "mysql2": "^3.0.0",
    "mongodb": "^6.0.0",
    "better-sqlite3": "^9.0.0",
    "ioredis": "^5.0.0"
  },
  "peerDependenciesMeta": {
    "mysql2": { "optional": true },
    "mongodb": { "optional": true },
    "better-sqlite3": { "optional": true },
    "ioredis": { "optional": true }
  }
}
```

Make database clients optional peer dependencies so users only install what they need.

---

## Phase 10: Performance Considerations

### 10.1 Streaming Optimization
- Ensure all providers use streaming (no buffering)
- Implement backpressure handling
- Add progress tracking per database type
- Monitor memory usage across all database types

### 10.2 Compression Strategy
- Test optimal compression levels per database
- PostgreSQL custom format: Already compressed, disable Brotli
- MySQL SQL dumps: High compression ratio with Brotli
- MongoDB BSON: Moderate compression with Brotli
- SQLite: High compression ratio with Brotli
- Redis RDB: Already compressed, test Brotli benefit

---

## Implementation Timeline

### Week 1-2: Architecture & Configuration
- Phase 1: Architecture Refactoring
- Phase 5: Configuration Updates

### Week 3-4: Core Providers
- Phase 2.1: PostgreSQL Provider (refactor existing)
- Phase 2.2: MySQL Provider
- Phase 2.4: SQLite Provider

### Week 5-6: Advanced Providers
- Phase 2.3: MongoDB Provider
- Phase 2.5: Redis Provider

### Week 7-8: Integration & Testing
- Phase 3: Backup Service Refactoring
- Phase 6: Testing Strategy

### Week 9-10: PITR & Documentation
- Phase 4: PITR Support
- Phase 7: Documentation Updates
- Phase 8: Migration Guide

### Week 11-12: Polish & Release
- Performance testing
- Bug fixes
- Release preparation

---

## Success Criteria

### Functional Requirements
- ✅ Support PostgreSQL, MySQL, MongoDB, SQLite, Redis
- ✅ Allow format selection per database type
- ✅ Maintain backward compatibility with config migration
- ✅ All formats work with compression pipeline
- ✅ All formats work with encryption pipeline
- ✅ PITR support where applicable

### Non-Functional Requirements
- ✅ Memory usage remains constant (streaming)
- ✅ Test coverage > 80%
- ✅ Documentation complete for all databases
- ✅ Migration guide for existing users
- ✅ Performance benchmarks for each database

### User Experience
- ✅ Simple configuration for each database type
- ✅ Clear error messages for unsupported formats
- ✅ Easy format selection via options
- ✅ Helpful validation messages

---

## Future Enhancements

### Phase 11: Restore Functionality
- Implement restore service per database type
- Format-specific restore logic
- PITR restore support

### Phase 12: Additional Databases
- Microsoft SQL Server
- CockroachDB
- TimescaleDB
- Cassandra

### Phase 13: Cloud Native Features
- Kubernetes CronJob templates
- Helm charts
- Docker images per database type
- Operator pattern for K8s

---

## Risk Mitigation

### Risk 1: CLI Tool Availability
**Mitigation:** Document system requirements, add validation checks

### Risk 2: Breaking Changes
**Mitigation:** Provide migration guide, maintain backward compatibility layer

### Risk 3: Performance Degradation
**Mitigation:** Benchmark each provider, maintain streaming architecture

### Risk 4: Complex Configuration
**Mitigation:** Keep config simple, provide clear examples, add validation

### Risk 5: Database Version Compatibility
**Mitigation:** Document supported versions, add version detection where possible
