# DBDock Usage Guide

## Quick Start

### 1. Configure Your Database and Storage

Create `dbdock.config.json`:

```json
{
  "postgres": {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "your-password",
    "database": "myapp"
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
  }
}
```

### 2. Create a Backup Programmatically

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BackupService } from './backup/backup.service';

async function backup() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const backupService = app.get(BackupService);

  const result = await backupService.createBackup({
    compress: true,
    encrypt: true,
  });

  console.log('Backup completed:', result.metadata.id);
  console.log('Storage key:', result.storageKey);
  console.log('Size:', result.metadata.size, 'bytes');
  console.log('Compressed size:', result.metadata.compressedSize, 'bytes');
  console.log('Duration:', result.metadata.duration, 'ms');

  await app.close();
}

backup();
```

### 3. List All Backups

```typescript
async function listBackups() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const backupService = app.get(BackupService);

  const backups = await backupService.listBackups();

  backups.forEach(backup => {
    console.log(`${backup.id} - ${backup.database} - ${backup.startTime}`);
    console.log(`  Status: ${backup.status}`);
    console.log(`  Size: ${backup.size} bytes`);
    console.log(`  Encrypted: ${backup.encryption ? 'Yes' : 'No'}`);
  });

  await app.close();
}
```

### 4. Backup Specific Tables/Schemas

```typescript
await backupService.createBackup({
  schemas: ['public', 'auth'],
  tables: ['users', 'posts'],
  compress: true,
  encrypt: true,
});
```

## Storage Options

### Local Storage

Best for development and testing.

```json
{
  "storage": {
    "provider": "local",
    "bucket": "dbdock-backups",
    "localPath": "./backups"
  }
}
```

### AWS S3

Production-ready cloud storage.

```json
{
  "storage": {
    "provider": "s3",
    "bucket": "my-backup-bucket",
    "endpoint": "https://s3.us-west-2.amazonaws.com",
    "accessKeyId": "AKIA...",
    "secretAccessKey": "..."
  }
}
```

### Cloudflare R2

S3-compatible with zero egress fees.

```json
{
  "storage": {
    "provider": "r2",
    "bucket": "my-backup-bucket",
    "endpoint": "abc123.r2.cloudflarestorage.com",
    "accessKeyId": "...",
    "secretAccessKey": "..."
  }
}
```

## Encryption

DBDock uses AES-256-GCM encryption for secure backups.

```json
{
  "encryption": {
    "enabled": true,
    "secret": "your-32-character-secret-key",
    "iterations": 100000
  }
}
```

**Important**: Keep your encryption secret safe! Without it, you cannot restore encrypted backups.

## Compression

Backups are compressed using Brotli compression by default. This typically reduces backup size by 70-90%.

To disable compression:

```typescript
await backupService.createBackup({
  compress: false,
});
```

## Backup Metadata

Each backup includes metadata stored alongside the backup file:

```json
{
  "id": "uuid-v4",
  "type": "full",
  "status": "completed",
  "database": "myapp",
  "startTime": "2025-01-10T12:00:00.000Z",
  "endTime": "2025-01-10T12:05:30.000Z",
  "duration": 330000,
  "size": 104857600,
  "compressedSize": 31457280,
  "storageKey": "backups/myapp/2025-01-10/uuid_12-00-00.backup",
  "compression": {
    "enabled": true,
    "algorithm": "brotli"
  },
  "encryption": {
    "algorithm": "aes-256-gcm",
    "salt": "base64-encoded-salt",
    "iv": "base64-encoded-iv"
  }
}
```

## Environment Variables

You can also configure DBDock using environment variables:

```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=myapp

STORAGE_PROVIDER=s3
STORAGE_BUCKET=my-backups
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...

ENCRYPTION_ENABLED=true
ENCRYPTION_SECRET=your-secret-key
```

## Best Practices

1. **Test Your Backups**: Regularly verify that backups can be restored
2. **Secure Your Keys**: Store encryption secrets in a secure vault (e.g., AWS Secrets Manager)
3. **Monitor Backup Size**: Track backup growth over time
4. **Set Up Alerts**: Configure email notifications for backup failures
5. **Use Versioning**: Enable versioning on your S3/R2 bucket for extra safety
6. **Offsite Storage**: Use cloud storage (S3/R2) for production backups

## WAL Archiving & Retention (Week 3)

### Enable Point-in-Time Recovery

```json
{
  "pitr": {
    "enabled": true,
    "walIntervalSeconds": 300,
    "retentionDays": 30
  }
}
```

### Archive WAL Files

```typescript
const walArchiver = app.get(WalArchiverService);

await walArchiver.archiveWalFile({
  walFile: '000000010000000000000001',
  walPath: '/var/lib/postgresql/wal_archive/000000010000000000000001',
});
```

### List Archived WAL Files

```typescript
const walFiles = await walArchiver.listWalFiles();
console.log(`Total WAL files: ${walFiles.length}`);

walFiles.forEach(wal => {
  console.log(`${wal.fileName} - ${wal.size} bytes - ${wal.archiveTime}`);
});
```

### Retention Policy Management

```typescript
const retentionService = app.get(RetentionService);

// Get retention report
const report = await retentionService.getRetentionReport();
console.log('Backups:', report.totalBackups);
console.log('To delete:', report.backupsToDelete);
console.log('Space to reclaim:', report.spaceToReclaim, 'bytes');

// Apply retention policy
const result = await retentionService.applyRetentionPolicy();
console.log('Deleted:', result.backupsDeleted, 'backups');
console.log('Deleted:', result.walFilesDeleted, 'WAL files');
console.log('Space saved:', result.spaceSaved, 'bytes');
```

### Custom Retention Policy

```typescript
await retentionService.applyRetentionPolicy({
  backupRetentionDays: 90,
  walRetentionDays: 30,
  minBackupsToKeep: 5,
  maxBackupsToKeep: 100,
});
```

### Automated Cleanup

DBDock automatically runs retention cleanup daily at 3 AM. You can also trigger it manually:

```typescript
const scheduler = app.get(SchedulerService);
await scheduler.manualRetentionCleanup();
```

For detailed WAL setup instructions, see [WAL_SETUP.md](WAL_SETUP.md).

## Coming Soon

- Restore functionality with PITR
- CLI commands
- Email notifications
- Scheduled backups
