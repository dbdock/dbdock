# WAL Archiving Setup Guide

## Overview

DBDock supports Point-in-Time Recovery (PITR) through PostgreSQL WAL (Write-Ahead Log) archiving. This allows you to restore your database to any point in time within your retention period.

## Prerequisites

- PostgreSQL 12 or higher
- DBDock with PITR enabled
- Sufficient storage for WAL files

## Step 1: Configure PostgreSQL

### Edit `postgresql.conf`

Add or modify the following settings:

```conf
# Enable WAL archiving
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /var/lib/postgresql/wal_archive/%f && cp %p /var/lib/postgresql/wal_archive/%f'

# Archive timeout (archives WAL every 5 minutes even if not full)
archive_timeout = 300

# Ensure full page writes (recommended for PITR)
full_page_writes = on

# WAL retention (optional - keeps WAL files for 24 hours)
wal_keep_size = 1GB
```

### Create WAL Archive Directory

```bash
sudo mkdir -p /var/lib/postgresql/wal_archive
sudo chown postgres:postgres /var/lib/postgresql/wal_archive
sudo chmod 700 /var/lib/postgresql/wal_archive
```

### Restart PostgreSQL

```bash
sudo systemctl restart postgresql
```

## Step 2: Configure DBDock

### Enable PITR in `dbdock.config.json`

```json
{
  "pitr": {
    "enabled": true,
    "walIntervalSeconds": 300,
    "retentionDays": 30
  }
}
```

### Configuration Options

- `enabled`: Enable/disable WAL archiving
- `walIntervalSeconds`: How often to check for new WAL files (default: 300)
- `retentionDays`: How long to keep WAL files (default: 30)

## Step 3: Verify PostgreSQL Configuration

### Check Settings

```sql
SELECT name, setting
FROM pg_settings
WHERE name IN ('wal_level', 'archive_mode', 'archive_command', 'archive_timeout');
```

Expected output:
```
      name       |                          setting
-----------------+-----------------------------------------------------------
 archive_command | test ! -f /var/lib/postgresql/wal_archive/%f && cp %p ...
 archive_mode    | on
 archive_timeout | 300
 wal_level       | replica
```

### Monitor Archiving

```sql
SELECT * FROM pg_stat_archiver;
```

This shows:
- `archived_count`: Number of WAL files archived
- `last_archived_wal`: Most recent WAL file archived
- `last_archived_time`: When it was archived
- `failed_count`: Number of failed archive attempts

## Step 4: Archive WAL Files with DBDock

### Manual Archiving

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WalArchiverService } from './wal/wal-archiver.service';

async function archiveWal() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const walArchiver = app.get(WalArchiverService);

  const result = await walArchiver.archiveWalFile({
    walFile: '000000010000000000000001',
    walPath: '/var/lib/postgresql/wal_archive/000000010000000000000001',
  });

  console.log('WAL archived:', result);
  await app.close();
}
```

### Automated Archiving with Cron

Create a script to archive WAL files:

```bash
#!/bin/bash
# /usr/local/bin/dbdock-wal-archive.sh

WAL_ARCHIVE_DIR="/var/lib/postgresql/wal_archive"

for wal_file in "$WAL_ARCHIVE_DIR"/*; do
  if [ -f "$wal_file" ]; then
    filename=$(basename "$wal_file")

    # Archive with DBDock
    node /path/to/dbdock/dist/wal-archive-cli.js \
      --file "$filename" \
      --path "$wal_file"

    # Remove local copy after successful archive
    if [ $? -eq 0 ]; then
      rm "$wal_file"
    fi
  fi
done
```

Add to crontab:

```bash
# Archive WAL files every 5 minutes
*/5 * * * * /usr/local/bin/dbdock-wal-archive.sh
```

## Step 5: Test WAL Archiving

### Generate WAL Activity

```sql
-- Create test data to force WAL generation
CREATE TABLE wal_test (id SERIAL PRIMARY KEY, data TEXT);
INSERT INTO wal_test (data) SELECT md5(random()::text) FROM generate_series(1, 100000);
```

### Force WAL Archive

```sql
-- Force a WAL switch to archive the current WAL file
SELECT pg_switch_wal();
```

### Verify Archive

```typescript
const walFiles = await walArchiver.listWalFiles();
console.log('Archived WAL files:', walFiles.length);
```

## Retention Policy

### Default Policy

DBDock automatically cleans up old WAL files based on retention settings:

- WAL files older than `retentionDays` are deleted
- Cleanup runs daily at 3 AM
- Manual cleanup can be triggered

### Manual Cleanup

```typescript
const deletedCount = await walArchiver.cleanupOldWalFiles(30);
console.log('Deleted WAL files:', deletedCount);
```

### View Retention Report

```typescript
const report = await retentionService.getRetentionReport();
console.log('Backups to delete:', report.backupsToDelete);
console.log('Space to reclaim:', report.spaceToReclaim, 'bytes');
```

## Monitoring

### Check WAL Archive Status

```sql
-- View archive status
SELECT * FROM pg_stat_archiver;

-- View current WAL file
SELECT pg_current_wal_lsn();

-- View WAL files waiting to be archived
SELECT * FROM pg_ls_waldir() ORDER BY modification DESC LIMIT 10;
```

### DBDock Logs

```bash
# View WAL archiving logs
tail -f /var/log/dbdock/wal-archiver.log
```

## Troubleshooting

### Archive Command Failing

**Symptom**: `failed_count` in `pg_stat_archiver` is increasing

**Solutions**:
1. Check directory permissions
2. Verify archive_command syntax
3. Ensure sufficient disk space
4. Check PostgreSQL logs: `tail -f /var/log/postgresql/postgresql-*.log`

### WAL Files Not Being Archived

**Check**:
```sql
SELECT archived_count, failed_count, last_failed_wal, last_failed_time
FROM pg_stat_archiver;
```

**Common Issues**:
- Archive directory doesn't exist
- Wrong permissions
- Disk full
- Archive command incorrect

### Performance Impact

WAL archiving has minimal performance impact, but you can tune:

```conf
# Reduce archive timeout if archiving too frequently
archive_timeout = 600  # 10 minutes

# Increase if you need more frequent archives
archive_timeout = 60   # 1 minute
```

## Best Practices

1. **Monitor Archive Lag**: Keep `pg_stat_archiver` lag under 5 minutes
2. **Test Restores**: Regularly test PITR restores
3. **Storage**: Ensure sufficient storage for WAL files (can be 10-20% of database size per day)
4. **Retention**: Balance between PITR coverage and storage costs
5. **Automation**: Set up automated archiving and cleanup
6. **Alerts**: Configure alerts for archive failures
7. **Offsite Storage**: Use S3/R2 for WAL files (built into DBDock)

## Point-in-Time Recovery

See [RESTORE.md](RESTORE.md) for PITR restore procedures (coming in Week 4).

## Advanced Configuration

### Multiple Timelines

DBDock automatically handles multiple timelines during restore operations.

### Compression and Encryption

WAL files are automatically:
- Compressed with Brotli
- Encrypted with AES-256-GCM (if encryption is enabled)
- Stored with metadata for verification

### Storage Backends

WAL files can be stored in:
- Local filesystem
- AWS S3
- Cloudflare R2
- Any S3-compatible storage

Same configuration as backups - just enable PITR.
