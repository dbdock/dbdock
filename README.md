<div align="center">
  <h1>DBDock</h1>
  <p><strong>Database backup and restore in under 60 seconds</strong></p>

  <p>
    <a href="#quick-start">Quick Start</a> •
    <a href="#features">Features</a> •
    <a href="#cli-reference">CLI Reference</a> •
    <a href="#programmatic-usage">Programmatic Usage</a> •
    <a href="#documentation">Documentation</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/PostgreSQL-12%2B-blue?logo=postgresql" alt="PostgreSQL 12+">
    <img src="https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js" alt="Node.js 18+">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
    <img src="https://img.shields.io/npm/v/dbdock.svg" alt="npm version">
  </p>
</div>

---

## Quick Start

Get your first database backup running in 3 commands:

```bash
npx dbdock init
npx dbdock test
npx dbdock backup
```

That's it. DBDock handles compression, encryption, and storage automatically.

---

## Why DBDock?

Stop spending hours configuring backup solutions. DBDock provides enterprise-grade PostgreSQL backups with a developer-friendly CLI and clean programmatic API. Get automated backups with point-in-time recovery, encryption, compression, and multi-cloud storage in under 60 seconds.

### Built for Developers

- **CLI-First Design** - Setup in under 60 seconds with interactive prompts
- **Zero Configuration Hassle** - Smart defaults, override when needed
- **Encrypted & Compressed** - AES-256 encryption and Brotli compression out of the box
- **Multiple Storage Options** - Local, S3, Cloudinary, or bring your own adapter
- **TypeScript Native** - Full type safety for programmatic usage

---

## Features

### Database Support
- **PostgreSQL 12+** - Full backup with point-in-time recovery (PITR), WAL archiving, and streaming replication

### Security
- **AES-256-GCM Encryption** - Military-grade encryption for backups
- **Streaming Encryption** - Never stores unencrypted data on disk
- **PBKDF2 Key Derivation** - 100,000 iterations for key strengthening

### Storage Providers
- **Local Storage** - Perfect for development and testing
- **AWS S3** - Industry-standard cloud storage
- **Cloudflare R2** - S3-compatible with zero egress fees
- **Cloudinary** - Media platform with generous free tier
- **Custom Adapters** - Extend to any storage provider

### Advanced Features
- **Point-in-Time Recovery** - Restore PostgreSQL to any point in time
- **Automatic Retention** - Policy-based cleanup with age and count rules
- **Email Alerts** - SMTP integration for backup notifications
- **Scheduled Backups** - Cron-based automation
- **Compression** - Brotli compression with 70-90% size reduction

---

## Installation

```bash
npm install dbdock
```

Or use directly with npx (no installation required):

```bash
npx dbdock init
```

---

## CLI Reference

### Initialize Configuration

Create a new configuration file with an interactive wizard:

```bash
npx dbdock init
```

This will guide you through:
- PostgreSQL connection details
- Storage provider setup (Local, S3, Cloudflare R2, Cloudinary)
- Encryption and compression options

### Create Backup

Run an immediate backup:

```bash
npx dbdock backup
```

#### Backup with CLI Flags

Override encryption and compression settings without modifying the config file:

```bash
npx dbdock backup --encrypt --compress

npx dbdock backup --no-encrypt --compress --compression-level 9

npx dbdock backup --encrypt --encryption-key your-64-character-hex-key --compress
```

**Available Flags:**
- `--encrypt` - Enable encryption for this backup
- `--no-encrypt` - Disable encryption for this backup
- `--compress` - Enable compression for this backup
- `--no-compress` - Disable compression for this backup
- `--encryption-key <key>` - Encryption key (32 bytes, 64 hex characters)
- `--compression-level <level>` - Compression level (0-11, default: 6)

### Restore Backup

Interactively select and restore from available backups:

```bash
npx dbdock restore
```

### Test Configuration

Verify database connection and storage configuration:

```bash
npx dbdock test
```

### Manage Schedules

View, add, or remove backup schedules:

```bash
npx dbdock schedule
```

---

## Configuration

After running `npx dbdock init`, you'll have a `dbdock.config.json` file:

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
    "compression": {
      "enabled": true,
      "level": 6
    },
    "encryption": {
      "enabled": true,
      "key": "your-32-character-encryption-key"
    }
  }
}
```

### Environment Variables

You can override any configuration value with environment variables:

```bash
export DBDOCK_DB_HOST=production-db.example.com
export DBDOCK_DB_PASSWORD=prod-password
export DBDOCK_S3_BUCKET=prod-backups

npx dbdock backup
```

### Custom Config Path

Use a custom configuration file location:

```bash
export DBDOCK_CONFIG_PATH=/path/to/config.json
npx dbdock backup
```

---

## Programmatic Usage

Use DBDock in your Node.js or NestJS applications:

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
  console.log('Restore completed');
}
```

### Schedule Backups

```typescript
DBDockModule.forRoot({
  // ... other config
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

---

## Storage Providers

### Local Storage

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

### AWS S3

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

### Cloudflare R2

```json
{
  "storage": {
    "provider": "s3",
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

### Cloudinary

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

---

## Point-in-Time Recovery (PostgreSQL)

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

Restore to a specific point in time:

```typescript
await backupService.restoreBackup('backup-id', {
  targetTime: new Date('2024-01-15T14:30:00Z'),
});
```

See [Point-in-Time Recovery Documentation](./docs/pitr.md) for full setup guide.

---

## Email Alerts

Get notified when backups succeed or fail:

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

---

## Retention Policies

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

---

## Documentation

- [Quick Start Guide](./docs/quick-start.md)
- [CLI Reference](./docs/cli-reference.md)
- [Configuration Guide](./CONFIGURATION.md)
- [Storage Providers](./docs/storage-providers.md)
- [Point-in-Time Recovery](./docs/pitr.md)
- [Email Alerts](./ALERTS.md)
- [Programmatic Usage](./docs/programmatic-usage.md)

---

## Requirements

- Node.js 18 or higher
- PostgreSQL 12+ (for PostgreSQL backups)
- MySQL 5.7+ (for MySQL backups)
- MongoDB 4.4+ (for MongoDB backups)

---

## Troubleshooting

### "pg_dump command not found"

Install PostgreSQL client tools:

```bash
brew install postgresql
```

### "Database connection failed"

Test your connection:

```bash
npx dbdock test
```

Verify credentials in `dbdock.config.json`

### "S3 access denied"

Ensure your IAM user has these permissions:
- `s3:PutObject`
- `s3:GetObject`
- `s3:ListBucket`

### More Issues?

Check the [troubleshooting guide](./docs/troubleshooting.md) or [open an issue](https://github.com/naheemolaide/dbdock/issues).

---

## Contributing

Contributions are welcome! Please read the [contributing guide](./CONTRIBUTING.md) first.

---

## License

MIT License - see [LICENSE](./LICENSE) file for details.

---

## Support

- GitHub Issues: [Report a bug](https://github.com/naheemolaide/dbdock/issues)
- Discussions: [Ask questions](https://github.com/naheemolaide/dbdock/discussions)

---

<div align="center">
  <p>Made with ❤️ for developers who value their data</p>
  <p>
    <a href="https://github.com/naheemolaide/dbdock">GitHub</a> •
    <a href="https://www.npmjs.com/package/dbdock">npm</a>
  </p>
</div>
