# Quick Start Guide

Get your first database backup running in under 60 seconds with DBDock.

## Prerequisites

- Node.js 18 or higher
- PostgreSQL, MySQL, MongoDB, or SQLite database
- Database client tools installed (`pg_dump` for PostgreSQL, `mysqldump` for MySQL, etc.)

## Installation

No installation required! Use npx to run DBDock directly:

```bash
npx dbdock init
```

Or install globally:

```bash
npm install -g dbdock
```

## Step 1: Initialize Configuration (30 seconds)

Run the interactive setup wizard:

```bash
npx dbdock init
```

You'll be guided through:

1. **Database Selection**
   ```
   ? Select database type: (Use arrow keys)
   > postgres
     mysql
     mongodb
     sqlite
   ```

2. **Connection Details**
   ```
   ? Database host: localhost
   ? Database port: 5432
   ? Database username: postgres
   ? Database password: ********
   ? Database name: myapp
   ```

3. **Storage Provider**
   ```
   ? Select storage provider: (Use arrow keys)
   > local
     s3
     cloudinary
   ```

4. **Security Options**
   ```
   ? Enable encryption? Yes
   ? Encryption key (32 characters): ********************************
   ? Enable compression? Yes
   ? Compression level: 6
   ```

Done! You'll see:
```
✓ Configuration saved to dbdock.config.json
```

## Step 2: Test Configuration (15 seconds)

Verify everything is set up correctly:

```bash
npx dbdock test
```

Expected output:
```
ℹ Testing DBDock configuration...

✓ Configuration loaded
✓ Database connection successful
✓ Storage configuration valid

✓ All tests passed! Your configuration is ready to use.
```

## Step 3: Create Your First Backup (15 seconds)

Run your first backup:

```bash
npx dbdock backup
```

You'll see:
```
✓ Backup completed successfully

✓ Backup ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
ℹ Storage key: backups/backup-2024-01-15T10-30-00-000Z.sql
ℹ Size: 45.32 MB
ℹ Duration: 12543ms
```

That's it! Your database is backed up, compressed, encrypted, and stored safely.

## What Just Happened?

DBDock just:
1. Connected to your database
2. Created a complete dump
3. Compressed it (typically 70-90% size reduction)
4. Encrypted it with AES-256
5. Uploaded it to your storage provider

All in one command.

## Next Steps

### Set Up Automated Backups

Create a daily backup schedule:

```bash
npx dbdock schedule
```

Select "Add new schedule" and choose "Every day at 2 AM".

### Test Restore

Make sure you can restore from your backup:

```bash
npx dbdock restore
```

Select your backup from the list and confirm.

**WARNING:** This will overwrite your current database. Test on a development database first.

### Production Deployment

#### Option 1: Cron Job

Add to your crontab:

```bash
0 2 * * * cd /path/to/project && npx dbdock backup
```

#### Option 2: Systemd Timer (Linux)

Create `/etc/systemd/system/dbdock-backup.service`:

```ini
[Unit]
Description=DBDock Backup Service

[Service]
Type=oneshot
WorkingDirectory=/path/to/project
ExecStart=/usr/bin/npx dbdock backup
```

Create `/etc/systemd/system/dbdock-backup.timer`:

```ini
[Unit]
Description=DBDock Backup Timer

[Timer]
OnCalendar=daily
OnCalendar=02:00

[Install]
WantedBy=timers.target
```

Enable and start:

```bash
sudo systemctl enable dbdock-backup.timer
sudo systemctl start dbdock-backup.timer
```

#### Option 3: Docker Container

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

RUN apk add --no-cache postgresql-client

WORKDIR /app

COPY dbdock.config.json .

CMD ["npx", "dbdock", "backup"]
```

Run:

```bash
docker build -t dbdock-backup .
docker run --rm dbdock-backup
```

### Environment-Specific Configurations

#### Development

```json
{
  "storage": {
    "provider": "local",
    "local": {
      "path": "./backups"
    }
  }
}
```

#### Staging

```json
{
  "storage": {
    "provider": "s3",
    "s3": {
      "bucket": "staging-backups",
      "region": "us-east-1"
    }
  }
}
```

#### Production

```json
{
  "storage": {
    "provider": "s3",
    "s3": {
      "bucket": "production-backups",
      "region": "us-east-1"
    }
  },
  "backup": {
    "compression": { "enabled": true, "level": 9 },
    "encryption": { "enabled": true },
    "retention": {
      "enabled": true,
      "maxAge": 30,
      "maxCount": 100,
      "minCount": 7
    }
  },
  "alerts": {
    "email": {
      "enabled": true,
      "to": ["devops@example.com"]
    }
  }
}
```

### Use Environment Variables

Keep sensitive data out of config files:

```bash
export DBDOCK_DB_PASSWORD=production-password
export DBDOCK_ENCRYPTION_KEY=your-32-character-encryption-key
export DBDOCK_S3_ACCESS_KEY_ID=AKIA...
export DBDOCK_S3_SECRET_ACCESS_KEY=secret

npx dbdock backup
```

## Common Scenarios

### Backup Before Deployment

Add to your CI/CD pipeline:

```yaml
- name: Create pre-deployment backup
  run: npx dbdock backup
```

### Multi-Environment Setup

Use different config files:

```bash
export DBDOCK_CONFIG_PATH=./config/production.json
npx dbdock backup
```

### Backup to Multiple Locations

Run multiple backups with different configs:

```bash
DBDOCK_CONFIG_PATH=./s3-config.json npx dbdock backup
DBDOCK_CONFIG_PATH=./local-config.json npx dbdock backup
```

### Monitor Backup Health

Set up email alerts:

```json
{
  "alerts": {
    "email": {
      "enabled": true,
      "smtp": {
        "host": "smtp.gmail.com",
        "port": 587,
        "auth": {
          "user": "your-email@gmail.com",
          "pass": "your-app-password"
        }
      },
      "from": "backups@example.com",
      "to": ["admin@example.com"]
    }
  }
}
```

## Troubleshooting

### "pg_dump: command not found"

Install PostgreSQL client:

```bash
brew install postgresql
```

Or on Ubuntu/Debian:

```bash
sudo apt-get install postgresql-client
```

### "Database connection failed"

Check your credentials:

```bash
npx dbdock test
```

Verify database is running:

```bash
psql -h localhost -U postgres -d myapp -c "SELECT 1"
```

### "Permission denied"

Check database permissions:

```sql
GRANT ALL PRIVILEGES ON DATABASE myapp TO postgres;
```

### "S3 access denied"

Verify IAM permissions include:
- `s3:PutObject`
- `s3:GetObject`
- `s3:ListBucket`

Test AWS credentials:

```bash
aws s3 ls s3://my-backups/
```

## Best Practices

1. **Test Restores Regularly**
   - Backups are useless if you can't restore
   - Test monthly in a staging environment

2. **Use Encryption in Production**
   - Always enable encryption for production backups
   - Store encryption keys in a secret manager

3. **Set Up Retention Policies**
   - Prevent unlimited storage costs
   - Keep at least 7 daily backups

4. **Enable Email Alerts**
   - Get notified when backups fail
   - Monitor backup health proactively

5. **Backup Before Major Changes**
   - Always backup before migrations
   - Create backup before schema changes

6. **Use Off-Site Storage**
   - Don't store backups on the same server as the database
   - Use S3 or similar cloud storage

7. **Document Your Process**
   - Document restore procedures
   - Train team members on recovery process

## Performance Tips

### For Large Databases (> 100GB)

Use higher compression for better space savings:

```json
{
  "backup": {
    "compression": {
      "enabled": true,
      "level": 9
    }
  }
}
```

### For Frequent Backups

Use lower compression for faster backups:

```json
{
  "backup": {
    "compression": {
      "enabled": true,
      "level": 1
    }
  }
}
```

### For Fast Networks

Disable compression when uploading to fast cloud storage:

```json
{
  "backup": {
    "compression": {
      "enabled": false
    }
  }
}
```

## Next Steps

- [CLI Reference](./cli-reference.md) - Complete CLI command documentation
- [Configuration Guide](../CONFIGURATION.md) - All configuration options
- [Programmatic Usage](./programmatic-usage.md) - Use DBDock in your code
- [Point-in-Time Recovery](./pitr.md) - Advanced PostgreSQL features

## Need Help?

- [GitHub Issues](https://github.com/naheemolaide/dbdock/issues)
- [Discussions](https://github.com/naheemolaide/dbdock/discussions)
