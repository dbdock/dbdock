# DBDock

Enterprise-grade PostgreSQL backup and restore. Beautiful CLI with real-time progress tracking.

[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Documentation](https://img.shields.io/badge/docs-dbdock.mintlify.app-blue)](https://dbdock.mintlify.app)

📚 **[Full Documentation](https://dbdock.mintlify.app)** | 💬 **[Discussions](https://github.com/naheemolaide/dbdock-support/discussions)** | 🐛 **[Issues](https://github.com/naheemolaide/dbdock-support/issues)**

## Quick Start

```bash
npx dbdock init      # Interactive setup
npx dbdock backup    # Create backup
npx dbdock restore   # Restore backup
```

## Features

- **Beautiful CLI** - Real-time progress bars, speed tracking, smart filtering
- **Multiple Storage** - Local, AWS S3, Cloudflare R2, Cloudinary
- **Security First** - Hybrid config (env vars for secrets), AES-256 encryption, credential masking, .pgpass support
- **Retention Policies** - Automatic cleanup by count/age with safety nets
- **Smart UX** - Intelligent filtering for 100+ backups, clear error messages
- **Alerts** - Email (SMTP) and Slack notifications for backups (CLI & Programmatic)
- **TypeScript Native** - Full type safety for programmatic usage
- **Automation** - Cron schedules, auto-cleanup after backups
- **Migration Tool** - One command to migrate legacy configs to secure env vars

## Installation

**Global Installation (Recommended):**

```bash
npm install -g dbdock

dbdock init      # Use directly
dbdock backup
dbdock status
```

**Or use with npx (No installation needed):**

```bash
npx dbdock init
npx dbdock backup
npx dbdock status
```

## CLI Commands

### `dbdock init`

Interactive setup wizard that creates secure configuration:

- Database connection (host, port, credentials)
- Storage provider (Local, S3, R2, Cloudinary)
- Encryption/compression settings
- Email and Slack alerts (optional)

**Security-first approach:**
- Saves non-sensitive config to `dbdock.config.json` (safe for git)
- Saves secrets to `.env` (automatically gitignored)
- Auto-updates `.gitignore` to exclude sensitive files

### `dbdock migrate-config`

Migrate existing configurations with embedded secrets:

```bash
npx dbdock migrate-config
```

Extracts secrets from `dbdock.config.json`, creates `.env`, and updates your config to use environment variables.

### `npx dbdock backup`

Creates database backup with real-time progress tracking:

```
████████████████████ | 100% | 45.23/100 MB | Speed: 12.50 MB/s | ETA: 0s | Uploading to S3
✔ Backup completed successfully
```

**Options:**

```bash
npx dbdock backup --encrypt --compress --compression-level 9
```

- `--encrypt` / `--no-encrypt` - Toggle encryption
- `--compress` / `--no-compress` - Toggle compression
- `--encryption-key <key>` - 64-char hex key (must be exactly 64 hexadecimal characters)
- `--compression-level <1-11>` - Compression level (default: 6)

**Generate encryption key:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Backup Formats:**

- `custom` (default) - PostgreSQL custom binary format (.sql)
- `plain` - Plain SQL text format (.sql)
- `directory` - Directory format (.dir)
- `tar` - Tar archive format (.tar)

### `npx dbdock restore`

Interactive restore with smart filtering and multi-step progress:

```
Progress:
────────────────────────────────────────────────────────
  ✔ Downloading backup
  ✔ Decrypting data
  ✔ Decompressing data
  ⟳ Restoring to database...
────────────────────────────────────────────────────────
✔ All steps completed in 8.42s
```

**Smart filtering** (auto-enabled for 20+ backups):

- Show recent (last 10)
- Date range (24h, 7d, 30d, 90d, custom)
- Search by keyword/ID

**Migration Support:**

You can choose to restore to a **New Database Instance** during the restore process. This is perfect for migrating data between servers (e.g., from staging to production or local to cloud).

1. Run `npx dbdock restore`
2. Select a backup
3. Choose "New Database Instance (Migrate)"
4. Enter connection details for the target database

Shows database stats and requires confirmation before restore.

### `npx dbdock list`

View backups with smart filtering:

```bash
npx dbdock list                  # All backups
npx dbdock list --recent 10      # Last 10
npx dbdock list --search keyword # Search
npx dbdock list --days 7         # Last 7 days
```

**Auto-filtering** for 50+ backups with interactive prompts.

### `npx dbdock delete`

Delete backups interactively or by key:

```bash
npx dbdock delete              # Interactive
npx dbdock delete --key <id>   # Specific backup
npx dbdock delete --all        # All (with confirmation)
```

### `npx dbdock cleanup`

Clean up old backups based on retention policy:

```bash
npx dbdock cleanup              # Interactive with preview
npx dbdock cleanup --dry-run    # Preview only
npx dbdock cleanup --force      # Skip confirmation
```

Shows detailed preview of what will be deleted and space to reclaim.

### `dbdock status`

Quick view of all schedules and service status:

```bash
dbdock status
```

**Output:**

```
📅 Scheduled Backups:

┌─────┬──────────────┬─────────────────┬──────────┐
│  #  │ Name         │ Cron Expression │ Status   │
├─────┼──────────────┼─────────────────┼──────────┤
│   1 │ daily        │ 0 * * * *       │ ✓ Active │
│   2 │ weekly       │ 0 0 * * 0       │ ✗ Paused │
└─────┴──────────────┴─────────────────┴──────────┘

Total: 2 schedule(s) - 1 active, 1 paused

🚀 Service Status:

🟢 Running (PM2)
  PID: 12345
  Uptime: 2d 5h
  Memory: 45.23 MB
```

### `dbdock test`

Validates database, storage, and email configuration.

### `dbdock schedule`

Manage backup schedules in configuration:

```bash
dbdock schedule
```

**Features:**

- View current schedules with status
- Add new schedule with cron expression presets
- Remove or toggle (enable/disable) schedules
- Saves to `dbdock.config.json`

**Schedule Presets:**

- Every hour: `0 * * * *`
- Every day at midnight: `0 0 * * *`
- Every day at 2 AM: `0 2 * * *`
- Every week (Sunday): `0 0 * * 0`
- Every month (1st): `0 0 1 * *`
- Custom cron expression

**⚠️ Important:** Schedules only execute when DBDock is integrated into your Node.js application (see Programmatic Usage below). The CLI is for configuration only.

## Security Best Practices

### Secure Configuration Management

DBDock uses a **hybrid configuration approach** to keep your secrets safe:

- **Non-sensitive settings** → `dbdock.config.json` (safe for version control)
- **Sensitive secrets** → Environment variables (NEVER commit to git)

When you run `npx dbdock init`, DBDock automatically:
- Saves credentials to `.env` (not committed)
- Saves only non-sensitive config to `dbdock.config.json`
- Updates `.gitignore` to exclude `.env`

**Note:** DBDock reads environment variables from both `.env` and `.env.local` files (with `.env.local` taking priority for local overrides). You can use either file depending on your workflow.

### Environment Variables

Set these environment variables for secure credential management:

```bash
# Database password (Required)
DBDOCK_DB_PASSWORD=your-database-password

# Storage credentials (Required for cloud storage)
DBDOCK_STORAGE_ACCESS_KEY=your-access-key
DBDOCK_STORAGE_SECRET_KEY=your-secret-key

# Encryption key (Required if encryption enabled)
# Generate with: openssl rand -hex 32
DBDOCK_ENCRYPTION_SECRET=64-char-hex-string

# Email alerts (Optional)
DBDOCK_SMTP_USER=your-email@example.com
DBDOCK_SMTP_PASS=your-app-password

# Slack alerts (Optional)
DBDOCK_SLACK_WEBHOOK=https://hooks.slack.com/services/...
```

### Migration from Legacy Config

If you have an existing configuration with secrets in `dbdock.config.json`:

```bash
npx dbdock migrate-config
```

This command will:
1. Extract all secrets from your config file
2. Create/update `.env` with the secrets
3. Remove secrets from `dbdock.config.json`
4. Update `.gitignore` automatically

### Using .pgpass for PostgreSQL

For enhanced security, use `.pgpass` instead of environment variables:

```bash
# Create the file
touch ~/.pgpass
chmod 600 ~/.pgpass

# Add your connection (format: host:port:database:username:password)
echo "localhost:5432:myapp:postgres:my-secure-password" >> ~/.pgpass
```

DBDock will automatically use `.pgpass` when available, which is more secure than `PGPASSWORD` environment variables.

### Security Features

- **Automatic credential masking** - All passwords and keys are masked in logs
- **File permission checking** - Warns about insecure config file permissions
- **Encryption at rest** - AES-256-GCM encryption for backups
- **Strict mode** - Optional enforcement of env-only secrets (`DBDOCK_STRICT_MODE=true`)

📖 **[Read the full Security Guide](SECURITY.md)** for deployment best practices, compliance guidelines, and incident response procedures.

## Configuration

After running `npx dbdock init`, a `dbdock.config.json` file is created (without sensitive data):

```json
{
  "_comment": "Secrets (passwords, keys) are set via environment variables",
  "database": {
    "type": "postgres",
    "host": "localhost",
    "port": 5432,
    "username": "postgres",
    "database": "myapp"
  },
  "storage": {
    "provider": "s3",
    "s3": {
      "bucket": "my-backups",
      "region": "us-east-1"
    }
  },
  "backup": {
    "format": "custom",
    "compression": {
      "enabled": true,
      "level": 6
    },
    "encryption": {
      "enabled": true
    },
    "retention": {
      "enabled": true,
      "maxBackups": 100,
      "maxAgeDays": 30,
      "minBackups": 5,
      "runAfterBackup": true
    }
  },
  "alerts": {
    "email": {
      "enabled": true,
      "smtp": {
        "host": "smtp.gmail.com",
        "port": 587,
        "secure": false
      },
      "from": "backups@yourapp.com",
      "to": ["admin@yourapp.com"]
    }
  }
}
```

**Note:** SMTP credentials (`user`, `pass`) and storage secrets are set via environment variables for security.

### Storage Providers

**Local:**

```json
{ "storage": { "provider": "local", "local": { "path": "./backups" } } }
```

**AWS S3:**

```json
{
  "storage": {
    "provider": "s3",
    "s3": {
      "bucket": "my-backups",
      "region": "us-east-1"
    }
  }
}
```

Set credentials via environment variables:
```bash
DBDOCK_STORAGE_ACCESS_KEY=your-access-key
DBDOCK_STORAGE_SECRET_KEY=your-secret-key
```

Required IAM permissions: `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject`

**Cloudflare R2:**

```json
{
  "storage": {
    "provider": "r2",
    "s3": {
      "bucket": "my-backups",
      "region": "auto",
      "endpoint": "https://ACCOUNT_ID.r2.cloudflarestorage.com"
    }
  }
}
```

Set credentials via environment variables (same as S3 above).

**Cloudinary:**

```json
{
  "storage": {
    "provider": "cloudinary",
    "cloudinary": {
      "cloudName": "your-cloud"
    }
  }
}
```

Set credentials via environment variables:
```bash
DBDOCK_CLOUDINARY_API_KEY=your-api-key
DBDOCK_CLOUDINARY_API_SECRET=your-api-secret
```

All cloud backups stored in `dbdock_backups/` folder with format: `backup-YYYY-MM-DD-HH-MM-SS-BACKUPID.sql`

### Retention Policy

Automatic cleanup to prevent storage bloat from frequent backups:

```json
{
  "backup": {
    "retention": {
      "enabled": true,
      "maxBackups": 100,
      "maxAgeDays": 30,
      "minBackups": 5,
      "runAfterBackup": true
    }
  }
}
```

**How it works:**

- Keeps most recent `minBackups` (safety net, never deleted)
- Deletes backups exceeding `maxBackups` limit (oldest first)
- Deletes backups older than `maxAgeDays` (respecting minBackups)
- Runs automatically after each backup (if `runAfterBackup: true`)
- Manual cleanup: `npx dbdock cleanup`

**Safety features:**

- Always preserves `minBackups` most recent backups
- Shows preview before deletion
- Detailed logging of what was deleted
- Error handling for failed deletions

## Programmatic Usage

Use DBDock in your Node.js application to create backups programmatically. You don't need to understand NestJS internals - DBDock provides a simple API that works with any Node.js backend.

### Basic Setup

First, install DBDock:

```bash
npm install dbdock
```

Make sure you have `dbdock.config.json` configured (run `npx dbdock init` first). DBDock reads all configuration from this file automatically.

### How It Works

DBDock uses a simple initialization pattern:

1. Call `createDBDock()` to initialize DBDock (reads from `dbdock.config.json`)
2. Get the `BackupService` from the returned context using `.get(BackupService)`
3. Use the service methods to create backups, list backups, etc.

Think of `createDBDock()` as a factory function that sets up everything for you based on your config file.

### Creating Backups

```javascript
const { createDBDock, BackupService } = require('dbdock');

async function createBackup() {
  const dbdock = await createDBDock();
  const backupService = dbdock.get(BackupService);

  const result = await backupService.createBackup({
    format: 'plain', // 'custom' (binary), 'plain' (sql), 'directory', 'tar'
    compress: true,
    encrypt: true,
  });

  console.log(`Backup created: ${result.metadata.id}`);
  console.log(`Size: ${result.metadata.formattedSize}`); // e.g. "108.3 KB"
  console.log(`Path: ${result.storageKey}`);
  
  return result;
}

createBackup().catch(console.error);
```

**Backup Options:**

- `compress` - Enable/disable compression (default: from config)
- `encrypt` - Enable/disable encryption (default: from config)
- `format` - Backup format: `'custom'` (default), `'plain'`, `'directory'`, `'tar'`
- `type` - Backup type: `'full'` (default), `'schema'`, `'data'`

### Listing Backups

```javascript
const { createDBDock, BackupService } = require('dbdock');

async function listBackups() {
  const dbdock = await createDBDock();
  const backupService = dbdock.get(BackupService);

  const backups = await backupService.listBackups();

  console.log(`Found ${backups.length} backups:`);
  backups.forEach(
    (backup: {
      id: string;
      formattedSize: string;
      startTime: string | Date;
    }) => {
      console.log(
        `- ${backup.id} (${backup.formattedSize}, created: ${backup.startTime})`
      );
    }
  );

  return backups;
}

listBackups().catch(console.error);
```

### Getting Backup Metadata

```javascript
const { createDBDock, BackupService } = require('dbdock');

async function getBackupInfo(backupId) {
  const dbdock = await createDBDock();
  const backupService = dbdock.get(BackupService);

  const metadata = await backupService.getBackupMetadata(backupId);
  
  if (!metadata) {
    console.log('Backup not found');
    return null;
  }
  
  console.log('Backup details:', {
    id: metadata.id,
    size: metadata.size,
    created: metadata.startTime,
    encrypted: !!metadata.encryption,
    compressed: metadata.compression.enabled,
  });
  
  return metadata;
}

getBackupInfo('your-backup-id').catch(console.error);
```

**Note:** Restore functionality is currently only available via CLI (`npx dbdock restore`). Programmatic restore will be available in a future release.

### Scheduling Backups

DBDock doesn't include a built-in scheduler (to keep the package lightweight), but it's easy to schedule backups using `node-cron`.

First, install `node-cron`:

```bash
npm install node-cron
npm install --save-dev @types/node-cron
```

Then create a scheduler script (e.g., `scheduler.ts`):

```typescript
import { createDBDock, BackupService } from 'dbdock';
import * as cron from 'node-cron';

async function startScheduler() {
  // Initialize DBDock
  const dbdock = await createDBDock();
  const backupService = dbdock.get(BackupService);

  console.log('🚀 Backup scheduler started. Running every minute...');

  // Schedule task to run every minute ('* * * * *')
  // For every 5 minutes use: '*/5 * * * *'
  // For every hour use: '0 * * * *'
  cron.schedule('* * * * *', async () => {
    try {
      console.log('\n⏳ Starting scheduled backup...');
      
      const result = await backupService.createBackup({
        format: 'plain', // Use 'plain' for SQL text, 'custom' for binary
        compress: true,
        encrypt: true,
      });

      console.log(`✅ Backup successful: ${result.metadata.id}`);
      console.log(`📦 Size: ${result.metadata.formattedSize}`);
      console.log(`📂 Path: ${result.storageKey}`);
    } catch (error) {
      console.error('❌ Backup failed:', error);
    }
  });
}

startScheduler().catch(console.error);
```

**Note:** The CLI `dbdock schedule` command manages configuration for external schedulers but does not run a daemon itself. Using `node-cron` as shown above is the recommended way to run scheduled backups programmatically.

### Alerts
 
DBDock can send notifications when backups complete (success or failure) via Email and Slack. Alerts work with both **programmatic usage** and **CLI commands**.
 
**Configuration in `dbdock.config.json`:**
 
```json
{
  "database": { ... },
  "storage": { ... },
  "backup": { ... },
  "alerts": {
    "email": {
      "enabled": true,
      "smtp": {
        "host": "smtp.gmail.com",
        "port": 587,
        "secure": false,
        "auth": {
          "user": "your-email@gmail.com",
          "pass": "your-app-password"
        }
      },
      "from": "backups@yourapp.com",
      "to": ["admin@yourapp.com", "devops@yourapp.com"]
    },
    "slack": {
      "enabled": true,
      "webhookUrl": "https://hooks.slack.com/services/..."
    }
  }
}
```
 
**Slack Configuration:**
 
1. Create a Slack App or use an existing one.
2. Enable "Incoming Webhooks".
3. Create a new Webhook URL for your channel.
4. Run `npx dbdock init` and paste the URL when prompted.
 
**SMTP Provider Examples:**
 
_Gmail:_
```json
{
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "secure": false,
    "auth": {
      "user": "your-email@gmail.com",
      "pass": "your-app-password"
    }
  }
}
```
 
> **Note:** For Gmail, you need to [create an App Password](https://support.google.com/accounts/answer/185833) instead of using your regular password.
 
_SendGrid:_
```json
{
  "smtp": {
    "host": "smtp.sendgrid.net",
    "port": 587,
    "secure": false,
    "auth": {
      "user": "apikey",
      "pass": "YOUR_SENDGRID_API_KEY"
    }
  }
}
```
 
_AWS SES:_
```json
{
  "smtp": {
    "host": "email-smtp.us-east-1.amazonaws.com",
    "port": 587,
    "secure": false,
    "auth": {
      "user": "YOUR_SMTP_USERNAME",
      "pass": "YOUR_SMTP_PASSWORD"
    }
  }
}
```
 
_Mailgun:_
```json
{
  "smtp": {
    "host": "smtp.mailgun.org",
    "port": 587,
    "secure": false,
    "auth": {
      "user": "postmaster@your-domain.mailgun.org",
      "pass": "YOUR_MAILGUN_SMTP_PASSWORD"
    }
  }
}
```
 
**Using Alerts Programmatically:**
 
Once configured in `dbdock.config.json`, alerts are sent automatically when you create backups programmatically:
 
```javascript
const { createDBDock, BackupService } = require('dbdock');
 
async function createBackupWithAlerts() {
  const dbdock = await createDBDock();
  const backupService = dbdock.get(BackupService);
 
  // Alerts will be sent automatically after backup completes
  const result = await backupService.createBackup({
    compress: true,
    encrypt: true,
  });
 
  console.log(`Backup created: ${result.metadata.id}`);
  // Alerts sent to configured channels
}
 
createBackupWithAlerts().catch(console.error);
```
 
**Alert Content:**
 
Success alerts include:
- Backup ID
- Database name
- Size (original and compressed)
- Duration
- Storage location
- Encryption status
 
Failure alerts include:
- Error message
- Database details
- Timestamp
- Helpful troubleshooting tips
 
**Testing Alert Configuration:**
 
Run `npx dbdock test` to validate your configuration without creating a backup.
 
**Important Notes:**
 
- ✅ Alerts work with programmatic usage (`createBackup()`)
- ✅ Alerts work with scheduled backups (cron jobs in your app)
- ✅ Alerts work with CLI commands (`npx dbdock backup`)
- Configuration is read from `dbdock.config.json` automatically
- Multiple recipients supported in the `to` array for email
- Alerts are sent asynchronously (won't block backup completion)

## Requirements

- Node.js 18 or higher
- PostgreSQL 12+
- PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`)

**Installing PostgreSQL client tools:**

```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql-client

# Windows
# Download from https://www.postgresql.org/download/windows/
```

## Troubleshooting

Run `npx dbdock test` to verify your configuration.

### Common Issues

**pg_dump not found:**

```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql-client
```

**Database connection errors:**

- Verify `host`, `port`, `username`, `password`, `database` in config
- Test connection: `psql -h HOST -p PORT -U USERNAME -d DATABASE`
- Check PostgreSQL server is running
- Verify network/firewall allows connection

**Storage errors:**

_AWS S3:_

- Verify credentials are correct
- Ensure IAM user has permissions: `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject`
- Check bucket name and region

_Cloudflare R2:_

- Verify API token is correct
- Check endpoint URL format: `https://ACCOUNT_ID.r2.cloudflarestorage.com`
- Ensure bucket exists and is accessible
- Verify R2 credentials have read/write permissions

_Cloudinary:_

- Verify cloud name, API key, and secret are correct
- Check your Cloudinary account is active
- Ensure API credentials have media library access

**Encryption key errors:**

```bash
# Generate a valid 64-character hex key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Must be exactly 64 hexadecimal characters (0-9, a-f, A-F)
```

**R2 restore not working:**

- Ensure backups are in `dbdock_backups/` folder
- Verify backup files are named with `.sql` extension
- Check endpoint configuration matches R2 account ID

**No backups found:**

- Local: Check files exist in configured path
- S3/R2: Verify files are in `dbdock_backups/` folder
- Cloudinary: Check Media Library for `dbdock_backups` folder
- Ensure files match pattern: `backup-*.sql`

DBDock shows clear, actionable error messages for all issues with specific troubleshooting steps.

## Documentation

📚 **[Full Documentation](https://dbdock.mintlify.app)** - Comprehensive guides, API reference, and examples

## Support

- 💬 **[Discussions](https://github.com/naheemolaide/dbdock-support/discussions)** - Ask questions and share ideas
- 🐛 **[Issues](https://github.com/naheemolaide/dbdock-support/issues)** - Report bugs and request features

## Links

- 📦 **[npm Package](https://www.npmjs.com/package/dbdock)**
- 📖 **[Documentation](https://dbdock.mintlify.app)**
- 💻 **[GitHub Repository](https://github.com/naheemolaide/dbdock-support)**

## License

MIT
