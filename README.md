# DBDock

Enterprise-grade PostgreSQL backup and restore in under 60 seconds.

[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

## Quick Start

```bash
npx dbdock init
npx dbdock test
npx dbdock backup
```

## Features

- **CLI-First Design** - Interactive setup in under 60 seconds
- **PostgreSQL Support** - Full backup with point-in-time recovery
- **Multiple Storage Providers** - Local, AWS S3, Cloudflare R2, Cloudinary
- **Security Built-In** - AES-256 encryption and Brotli compression
- **Organized Storage** - All cloud backups stored in `dbdock_backups` folder
- **Direct Download URLs** - Get instant download links for cloud backups
- **Smart Error Messages** - Clear, actionable error guidance
- **Email Alerts** - SMTP notifications with custom templates
- **Auto .gitignore** - Prevents credentials from being committed
- **TypeScript Native** - Full type safety for programmatic usage
- **Automated Schedules** - Cron-based backup automation
- **Retention Policies** - Automatic cleanup of old backups

## Installation

```bash
npm install dbdock
```

Or use without installation:

```bash
npx dbdock init
```

## CLI Usage

### Initialize Configuration

Create your configuration file with an interactive setup wizard:

```bash
npx dbdock init
```

The wizard will guide you through:
- Database connection details
- Backup format selection (Custom, Plain SQL, Directory, Tar)
- Storage provider selection (Local, S3, R2, Cloudinary)
- Encryption and compression preferences
- Email alert configuration with SMTP setup

**Automatic .gitignore Setup:**
- Config file (`dbdock.config.json`) automatically added to .gitignore
- Local backup folder automatically ignored
- Prevents accidental commit of sensitive credentials

### Create Backup

```bash
npx dbdock backup
```

**Output includes:**
- Backup ID and size
- Encryption and compression status
- Storage location details
- **Direct download URL** for cloud backups
- Console/dashboard links

**Example Output:**
```
✔ Backup completed successfully
✓ Backup ID: 7b0524ad7b40b742c63c3e6298bef5d5
ℹ Size: 0.19 MB
ℹ Duration: 2216ms
ℹ Encryption: enabled
ℹ Compression: enabled (level 1)

Storage Location:
  Provider: Cloudinary
  Cloud: your-cloud-name
  Resource ID: dbdock_backups/backup-2025-11-22T17-37-18-474Z-abc123.sql
  Download URL: https://res.cloudinary.com/your-cloud/raw/upload/dbdock_backups/backup-2025-11-22T17-37-18-474Z-abc123.sql
  Console: https://console.cloudinary.com/console/your-cloud/media_library
```

**Override settings with flags:**
```bash
npx dbdock backup --encrypt --compress --compression-level 9
```

**Available Options:**
- `--encrypt` / `--no-encrypt` - Enable or disable encryption
- `--compress` / `--no-compress` - Enable or disable compression
- `--encryption-key <key>` - 32-byte encryption key (64 hex characters)
- `--compression-level <level>` - Compression level (1-11, default: 6)

### Restore Backup

Select and restore from available backups:

```bash
npx dbdock restore
```

**Features:**
- Shows current database statistics before restore
- Lists all available backups with size and date
- Displays backup age (e.g., "2 days ago")
- Requires confirmation before overwriting database
- **Smart error messages** if backups not found

**Example Flow:**
```
✔ Configuration loaded
✔ Database analysis complete

Current Database Statistics:
  Database: myapp
  Tables: 15
  Total Size: 45 MB
  Estimated Rows: 125,430

? Select backup to restore:
  ❯ backup-2025-11-22T17-37-18-474Z-abc123.sql (0.19 MB) - 11/22/2025, 5:37:18 PM
    backup-2025-11-21T14-20-10-123Z-def456.sql (0.18 MB) - 11/21/2025, 2:20:10 PM

Selected Backup Details:
  Backup: backup-2025-11-22T17-37-18-474Z-abc123.sql
  Size: 0.19 MB
  Created: 11/22/2025, 5:37:18 PM
  Age: 2 hours ago

? This will overwrite the current database. Continue? (y/N)
```

### Test Configuration

Verify your database connection, storage, and email setup:

```bash
npx dbdock test
```

**Tests performed:**
- PostgreSQL connection and authentication
- Database access permissions
- Storage provider credentials and permissions
- **Email/SMTP configuration** (if enabled)
- Network connectivity to services

**Example Output:**
```
✔ Configuration loaded
✔ Database connection successful
✔ Storage configuration valid
✔ Email configuration valid

All tests passed! Your configuration is ready to use.
```

### Manage Schedules

View, add, or remove automated backup schedules:

```bash
npx dbdock schedule
```

## Configuration

After running `npx dbdock init`, a `dbdock.config.json` file is created:

```json
{
  "database": {
    "type": "postgres",
    "host": "localhost",
    "port": 5432,
    "username": "postgres",
    "password": "your-password",
    "database": "myapp"
  },
  "storage": {
    "provider": "s3",
    "s3": {
      "bucket": "my-backups",
      "region": "us-east-1",
      "accessKeyId": "YOUR_ACCESS_KEY",
      "secretAccessKey": "YOUR_SECRET_KEY"
    }
  },
  "backup": {
    "format": "custom",
    "compression": {
      "enabled": true,
      "level": 6
    },
    "encryption": {
      "enabled": true,
      "key": "your-32-character-encryption-key"
    }
  },
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
      "to": ["admin@yourapp.com"]
    }
  }
}
```

### Environment Variables

Override configuration values using environment variables:

```bash
export DBDOCK_DB_HOST=production.example.com
export DBDOCK_DB_PASSWORD=prod-password
export DBDOCK_S3_BUCKET=prod-backups
npx dbdock backup
```

### Custom Config Path

Specify a custom configuration file location:

```bash
export DBDOCK_CONFIG_PATH=/path/to/config.json
npx dbdock backup
```

### Backup Format Options

Choose your backup format based on your needs:

| Format | Value | Description | Use Case |
|--------|-------|-------------|----------|
| **Custom** (recommended) | `custom` | Compressed binary format (pg_dump -Fc) | Best for most use cases. Supports selective restore and parallel restore. |
| **Plain SQL** | `plain` | Plain text SQL statements | Human-readable, version control friendly, but larger file size. |
| **Directory** | `directory` | Directory of files (pg_dump -Fd) | Best for very large databases. Enables parallel dump and restore. |
| **Tar Archive** | `tar` | Tar archive format (pg_dump -Ft) | Similar to custom but as tar file. |

Configure in `dbdock.config.json`:

```json
{
  "backup": {
    "format": "custom"
  }
}
```

**Note:** The `custom` format is recommended as it provides the best balance of compression, flexibility, and restore options.

## Storage Providers

All cloud backups are automatically organized in a `dbdock_backups` folder for easy management.

### Local Storage

Backups stored on your local filesystem.

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

**Folder structure:**
```
./backups/
├── backup-2025-11-22T17-37-18-474Z-abc123.sql
└── backup-2025-11-21T14-20-10-123Z-def456.sql
```

### AWS S3

Store backups in Amazon S3 with automatic folder organization.

```json
{
  "storage": {
    "provider": "s3",
    "s3": {
      "bucket": "my-backups",
      "region": "us-east-1",
      "accessKeyId": "YOUR_ACCESS_KEY",
      "secretAccessKey": "YOUR_SECRET_KEY"
    }
  }
}
```

**Folder structure:**
```
my-bucket/
└── dbdock_backups/
    ├── backup-2025-11-22T17-37-18-474Z-abc123.sql
    └── backup-2025-11-21T14-20-10-123Z-def456.sql
```

**Required IAM permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-backups",
        "arn:aws:s3:::my-backups/*"
      ]
    }
  ]
}
```

### Cloudflare R2

S3-compatible storage with zero egress fees.

```json
{
  "storage": {
    "provider": "r2",
    "s3": {
      "bucket": "my-backups",
      "region": "auto",
      "endpoint": "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
      "accessKeyId": "YOUR_ACCESS_KEY",
      "secretAccessKey": "YOUR_SECRET_KEY"
    }
  }
}
```

**Folder structure:**
```
my-bucket/
└── dbdock_backups/
    ├── backup-2025-11-22T17-37-18-474Z-abc123.sql
    └── backup-2025-11-21T14-20-10-123Z-def456.sql
```

### Cloudinary

Media platform with generous free tier and automatic CDN distribution.

```json
{
  "storage": {
    "provider": "cloudinary",
    "cloudinary": {
      "cloudName": "your-cloud-name",
      "apiKey": "your-api-key",
      "apiSecret": "your-api-secret"
    }
  }
}
```

**Folder structure in Cloudinary:**
```
dbdock_backups/
├── backup-2025-11-22T17-37-18-474Z-abc123
└── backup-2025-11-21T14-20-10-123Z-def456
```

## Programmatic Usage

### NestJS Integration

```typescript
import { Module } from '@nestjs/common';
import { DBDockModule } from 'dbdock';

@Module({
  imports: [
    DBDockModule.forRoot({
      database: {
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: process.env.DB_PASSWORD,
        database: 'myapp',
      },
      storage: {
        provider: 's3',
        s3: {
          bucket: 'my-backups',
          region: 'us-east-1',
          accessKeyId: process.env.AWS_ACCESS_KEY,
          secretAccessKey: process.env.AWS_SECRET_KEY,
        },
      },
      backup: {
        compression: { enabled: true, level: 6 },
        encryption: { enabled: true, key: process.env.ENCRYPTION_KEY },
      },
    }),
  ],
})
export class AppModule {}
```

### Create Backup

```typescript
import { BackupService } from 'dbdock';

@Injectable()
export class MyService {
  constructor(private backupService: BackupService) {}

  async createBackup() {
    const result = await this.backupService.createBackup();
    console.log(`Backup ID: ${result.metadata.id}`);
    console.log(`Size: ${result.metadata.size} bytes`);
  }
}
```

### Restore Backup

```typescript
async restore() {
  await this.backupService.restoreBackup('backup-id-here');
}
```

### Schedule Backups

```typescript
DBDockModule.forRoot({
  backup: {
    schedules: [
      {
        name: 'Daily Backup',
        cron: '0 2 * * *',
        enabled: true,
      },
    ],
  },
})
```

## Advanced Features

### Point-in-Time Recovery

Enable continuous backup and restore to any point in time:

```json
{
  "backup": {
    "pitr": {
      "enabled": true,
      "walArchiveCommand": "dbdock wal-archive %p"
    }
  }
}
```

Restore to specific timestamp:

```typescript
await backupService.restoreBackup('backup-id', {
  targetTime: new Date('2024-01-15T14:30:00Z'),
});
```

### Email Alerts

Get notified when backups succeed or fail. Configure during setup with `npx dbdock init` or add manually to your config:

```json
{
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
    }
  }
}
```

**Gmail Setup:**
1. Enable 2-factor authentication
2. Generate an app password at [Google Account Security](https://myaccount.google.com/security)
3. Use the app password in the `pass` field

**Custom Email Templates:**

You can provide a custom email template path in your configuration:

```json
{
  "alerts": {
    "email": {
      "enabled": true,
      "customTemplate": "./email-templates/backup-notification.html",
      "smtp": { ... }
    }
  }
}
```

Create your custom template with placeholders:

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .success { color: green; }
    .error { color: red; }
  </style>
</head>
<body>
  <h1>Backup {{status}}</h1>
  <p>Backup ID: {{backupId}}</p>
  <p>Database: {{database}}</p>
  <p>Size: {{size}}</p>
  <p>Duration: {{duration}}</p>
  {{#if error}}
  <p class="error">Error: {{error}}</p>
  {{/if}}
</body>
</html>
```

Available template variables:
- `{{status}}` - "Successful" or "Failed"
- `{{backupId}}` - Unique backup identifier
- `{{database}}` - Database name
- `{{size}}` - Backup file size
- `{{duration}}` - Time taken for backup
- `{{timestamp}}` - When backup was created
- `{{error}}` - Error message (only for failures)

Test your email configuration:

```bash
npx dbdock test
```

### Retention Policies

Automatically clean up old backups:

```json
{
  "backup": {
    "retention": {
      "enabled": true,
      "maxAge": 30,
      "maxCount": 100,
      "minCount": 5
    }
  }
}
```

## Requirements

- Node.js 18 or higher
- PostgreSQL 12+
- PostgreSQL client tools (pg_dump, psql)

## Troubleshooting

DBDock provides clear, actionable error messages to help you quickly resolve issues.

### Common Issues

**pg_dump command not found**

Install PostgreSQL client tools:
- **macOS:** `brew install postgresql`
- **Ubuntu/Debian:** `sudo apt-get install postgresql-client`
- **Windows:** Download from [PostgreSQL website](https://www.postgresql.org/download/windows/)

**Database connection failed**

DBDock will show specific errors:
```
✖ Backup failed
Cannot connect to PostgreSQL server

Connection details:
  Host: localhost
  Port: 5432

Please verify:
  • PostgreSQL server is running
  • Host and port are correct in dbdock.config.json
  • Network/firewall allows connection
  • Test connection: psql -h localhost -p 5432 -U postgres -d myapp
```

Run `npx dbdock test` to verify all settings.

**Authentication failed**

```
✖ Backup failed
Authentication failed for user "postgres"

Please verify:
  • Username is correct in dbdock.config.json
  • Password is correct in dbdock.config.json
  • User exists and has access to the database
  • Test connection: psql -h localhost -p 5432 -U postgres -d myapp
```

**No backups found during restore**

DBDock shows where to check:
```
✖ No backups found

Please verify:
  • Backups exist in Cloudinary cloud: your-cloud-name
  • Files are in folder: dbdock_backups
  • Files are named: backup-*.sql
  • Your API credentials are correct
  • Check: https://console.cloudinary.com/console/your-cloud-name/media_library/folders/dbdock_backups

To create a backup, run:
  npx dbdock backup
```

**Storage access denied**

For S3/R2, ensure IAM permissions:
```json
{
  "Action": [
    "s3:PutObject",
    "s3:GetObject",
    "s3:ListBucket",
    "s3:DeleteObject"
  ]
}
```

For Cloudinary, verify API credentials have media library access.

**Email/SMTP errors**

Run `npx dbdock test` to verify SMTP connection:
```
✖ Test failed
SMTP authentication failed. Please check your username and password

Common email issues:
  • Verify cloud name, API key, and secret are correct
  • Check your Cloudinary account is active
  • Ensure API credentials have media library access
```

## License

MIT

## Support

- [GitHub Issues](https://github.com/naheemolaide/dbdock/issues)
- [GitHub Discussions](https://github.com/naheemolaide/dbdock/discussions)

## Links

- [npm Package](https://www.npmjs.com/package/dbdock)
- [GitHub Repository](https://github.com/naheemolaide/dbdock)
