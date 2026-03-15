# DBDock

Stop writing backup scripts. Stop losing sleep over database migrations. DBDock handles PostgreSQL backups, restores, and database copies in one command.

[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Documentation](https://img.shields.io/badge/docs-dbdock.mintlify.app-blue)](https://dbdock.mintlify.app)

[Full Docs](https://dbdock.mintlify.app) ・ [Discussions](https://github.com/naheemolaide/dbdock-support/discussions) ・ [Report a Bug](https://github.com/naheemolaide/dbdock-support/issues)

---

## The Problem

Every time you need to backup a database, copy it to staging, or restore before a migration — it's the same boring steps. Connect, dump, upload, move files around, remember the right flags. Sure, you could ask AI to write you a script. But then you're maintaining that script, handling errors, adding encryption, switching storage providers, doing it again next week.

It's not hard. It's just repetitive. And repetitive stuff should be one command.

## The Fix

```bash
npx dbdock init                          # One-time setup (takes 30 seconds)
npx dbdock backup                        # Backup with encryption + compression
npx dbdock restore                       # Restore from any backup
npx dbdock copydb "db_url_1" "db_url_2"  # Copy entire database, zero config
```

That's it. No shell scripts. No manual uploads. No config files for `copydb`.

---

## Install

**Use directly with npx (no install needed):**

```bash
npx dbdock backup
```

**Or install globally:**

```bash
npm install -g dbdock
```

**Prerequisites:** Node.js 18+ and PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`).

```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql-client
```

---

## Commands

### `dbdock init` — Set up in 30 seconds

Run once. It walks you through everything interactively:

```bash
npx dbdock init
```

It asks for your database connection, picks your storage (Local, S3, R2, Cloudinary), sets up encryption if you want it, and optionally configures Slack/Email alerts.

**What happens under the hood:**
- Config (safe stuff) goes to `dbdock.config.json` — commit this
- Secrets go to `.env` — never committed, `.gitignore` updated automatically

---

### `dbdock backup` — One command, full backup

```bash
npx dbdock backup
```

```
████████████████████ | 100% | 45.23 MB | Speed: 12.50 MB/s | Uploading to S3
✔ Backup completed successfully
```

Real-time progress. Streams directly to your storage provider. Done.

**Options:**

| Flag | What it does |
|------|------|
| `--encrypt` / `--no-encrypt` | Toggle AES-256 encryption |
| `--compress` / `--no-compress` | Toggle Brotli compression |
| `--encryption-key <key>` | Custom 64-char hex key |
| `--compression-level <1-11>` | Compression intensity (default: 6) |

**Need an encryption key?**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Backup formats:** `custom` (default binary), `plain` (SQL text), `directory`, `tar`

---

### `dbdock restore` — Interactive restore with smart filtering

```bash
npx dbdock restore
```

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

Got 200+ backups? It auto-enables smart filtering — search by date, keyword, or just grab the most recent ones. No scrolling through walls of text.

You can also restore to a completely different database. Pick "New Database Instance (Migrate)" when prompted and enter the target connection details.

---

### `dbdock copydb` — Copy a database with just two URLs

This is the one people love. No config files. No setup. Just paste two PostgreSQL URLs:

```bash
npx dbdock copydb "postgresql://user:pass@source:5432/mydb" "postgresql://user:pass@target:5432/mydb"
```

It tests both connections, shows you the source DB size and table count, warns you if the target has existing data, and asks for confirmation before doing anything. Then it streams `pg_dump` directly into `pg_restore` — no temp files, no waiting.

**Options:**

| Flag | What it does |
|------|------|
| `--schema-only` | Copy tables, indexes, constraints — no data |
| `--data-only` | Copy data only (schema must exist on target) |
| `--verbose` | Show detailed pg_dump/pg_restore output |

```bash
npx dbdock copydb --schema-only "source_url" "target_url"
npx dbdock copydb --data-only "source_url" "target_url"
```

**Perfect for:**
- Moving between Neon, Supabase, Railway, RDS, or any Postgres host
- Migrating cloud providers without the headache

**Environment consolidation:**

```bash
# Refresh staging with production data
npx dbdock copydb "prod_url" "staging_url"

# Promote staging to production
npx dbdock copydb "staging_url" "prod_url"

# Pull production to local for debugging
npx dbdock copydb "prod_url" "postgresql://postgres:pass@localhost:5432/myapp"

# Align schema across environments without touching data
npx dbdock copydb --schema-only "prod_url" "staging_url"
```

---

### `dbdock list` — See all your backups

```bash
npx dbdock list                  # Everything
npx dbdock list --recent 10      # Last 10
npx dbdock list --search keyword # Find specific backup
npx dbdock list --days 7         # Last 7 days
```

Auto-filters when you have 50+ backups so the output stays clean.

---

### `dbdock delete` — Remove backups

```bash
npx dbdock delete              # Interactive picker
npx dbdock delete --key <id>   # Delete specific backup
npx dbdock delete --all        # Nuke everything (with confirmation)
```

---

### `dbdock cleanup` — Auto-clean old backups

```bash
npx dbdock cleanup              # Interactive with preview
npx dbdock cleanup --dry-run    # See what would be deleted
npx dbdock cleanup --force      # Skip confirmation
```

Shows you exactly what gets deleted and how much space you reclaim before doing anything.

---

### `dbdock status` — Check schedules and service health

```bash
npx dbdock status
```

```
┌─────┬──────────────┬─────────────────┬──────────┐
│  #  │ Name         │ Cron Expression │ Status   │
├─────┼──────────────┼─────────────────┼──────────┤
│   1 │ daily        │ 0 * * * *       │ ✓ Active │
│   2 │ weekly       │ 0 0 * * 0       │ ✗ Paused │
└─────┴──────────────┴─────────────────┴──────────┘
```

---

### `dbdock schedule` — Manage cron schedules

```bash
npx dbdock schedule
```

Add, remove, or toggle backup schedules. Comes with presets (hourly, daily at midnight, daily at 2 AM, weekly, monthly) or use a custom cron expression.

**Heads up:** Schedules only run when DBDock is integrated into your Node.js app (see [Programmatic Usage](#programmatic-usage) below). The CLI just manages the config.

---

### `dbdock test` — Verify everything works

```bash
npx dbdock test
```

Tests your database connection, storage provider, and alert config. Run this first if something feels off.

---

### `dbdock migrate-config` — Fix legacy configs

```bash
npx dbdock migrate-config
```

Got secrets sitting in `dbdock.config.json` from an older version? This extracts them to `.env`, cleans up your config, and updates `.gitignore`. One command, done.

---

## Storage Providers

Pick your storage during `dbdock init`, or set it in `dbdock.config.json`:

### Local

```json
{ "storage": { "provider": "local", "local": { "path": "./backups" } } }
```

### AWS S3

```json
{
  "storage": {
    "provider": "s3",
    "s3": { "bucket": "my-backups", "region": "us-east-1" }
  }
}
```

```bash
DBDOCK_STORAGE_ACCESS_KEY=your-access-key
DBDOCK_STORAGE_SECRET_KEY=your-secret-key
```

Needs IAM permissions: `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject`

### Cloudflare R2

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

Same env vars as S3 above.

### Cloudinary

```json
{
  "storage": {
    "provider": "cloudinary",
    "cloudinary": { "cloudName": "your-cloud" }
  }
}
```

```bash
DBDOCK_CLOUDINARY_API_KEY=your-api-key
DBDOCK_CLOUDINARY_API_SECRET=your-api-secret
```

---

## Security

DBDock splits your config into two parts by design:

| What | Where | Git safe? |
|------|-------|-----------|
| Host, port, bucket names, settings | `dbdock.config.json` | Yes |
| Passwords, API keys, secrets | `.env` | No (auto-gitignored) |

### Environment Variables

```bash
DBDOCK_DB_PASSWORD=your-database-password           # Required
DBDOCK_STORAGE_ACCESS_KEY=your-access-key            # For cloud storage
DBDOCK_STORAGE_SECRET_KEY=your-secret-key            # For cloud storage
DBDOCK_ENCRYPTION_SECRET=64-char-hex-string          # If encryption enabled
DBDOCK_SMTP_USER=your-email@example.com              # For email alerts
DBDOCK_SMTP_PASS=your-app-password                   # For email alerts
DBDOCK_SLACK_WEBHOOK=https://hooks.slack.com/...     # For Slack alerts
```

Reads from both `.env` and `.env.local` (`.env.local` takes priority).

### .pgpass Support

If you prefer `.pgpass` over env vars for the database password, DBDock detects and uses it automatically:

```bash
touch ~/.pgpass && chmod 600 ~/.pgpass
echo "localhost:5432:myapp:postgres:my-secure-password" >> ~/.pgpass
```

### What's Built In

- AES-256 encryption at rest
- Automatic credential masking in all logs
- File permission warnings for insecure configs
- Strict mode (`DBDOCK_STRICT_MODE=true`) — enforces env-only secrets

---

## Retention Policy

Backups pile up fast. Retention handles it automatically:

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

- Keeps at least `minBackups` recent backups (safety net — these never get deleted)
- Removes anything over `maxBackups` (oldest first)
- Removes anything older than `maxAgeDays`
- Runs automatically after each backup if `runAfterBackup` is on
- Or run manually: `npx dbdock cleanup`

---

## Alerts

Get notified on Slack or Email when backups succeed or fail. Set it up during `dbdock init` or add to your config:

```json
{
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
    },
    "slack": {
      "enabled": true,
      "webhookUrl": "https://hooks.slack.com/services/..."
    }
  }
}
```

SMTP credentials go in env vars (`DBDOCK_SMTP_USER`, `DBDOCK_SMTP_PASS`).

**Works with:** Gmail, SendGrid, AWS SES, Mailgun — anything that speaks SMTP.

> For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833), not your regular password.

Alerts fire automatically on both CLI and programmatic backups. They include backup ID, database name, size, duration, and storage location. Failure alerts include the error message and troubleshooting tips.

---

## Programmatic Usage

Don't just use the CLI — drop DBDock into your Node.js app and trigger backups from code. Works with any backend (Express, Fastify, NestJS, whatever).

```bash
npm install dbdock
```

Make sure `dbdock.config.json` exists (run `npx dbdock init` first).

### Create a Backup

```javascript
const { createDBDock, BackupService } = require('dbdock');

async function backup() {
  const dbdock = await createDBDock();
  const backupService = dbdock.get(BackupService);

  const result = await backupService.createBackup({
    format: 'plain',
    compress: true,
    encrypt: true,
  });

  console.log(`Done: ${result.metadata.id} (${result.metadata.formattedSize})`);
}

backup();
```

**Options:** `compress`, `encrypt`, `format` (`'custom'` | `'plain'` | `'directory'` | `'tar'`), `type` (`'full'` | `'schema'` | `'data'`)

### List Backups

```javascript
const { createDBDock, BackupService } = require('dbdock');

async function list() {
  const dbdock = await createDBDock();
  const backups = await dbdock.get(BackupService).listBackups();
  backups.forEach(b => console.log(`${b.id} — ${b.formattedSize} — ${b.startTime}`));
}

list();
```

### Get Backup Info

```javascript
const { createDBDock, BackupService } = require('dbdock');

async function info(id) {
  const dbdock = await createDBDock();
  const metadata = await dbdock.get(BackupService).getBackupMetadata(id);
  if (!metadata) return console.log('Not found');
  console.log({ id: metadata.id, size: metadata.size, encrypted: !!metadata.encryption });
}

info('your-backup-id');
```

Restore is CLI-only for now (`npx dbdock restore`). Programmatic restore is coming.

### Schedule Backups with node-cron

DBDock stays lightweight — no built-in daemon. Use `node-cron` to schedule:

```bash
npm install node-cron
```

```typescript
import { createDBDock, BackupService } from 'dbdock';
import * as cron from 'node-cron';

async function start() {
  const dbdock = await createDBDock();
  const backupService = dbdock.get(BackupService);

  cron.schedule('0 2 * * *', async () => {
    const result = await backupService.createBackup({ compress: true, encrypt: true });
    console.log(`Backup done: ${result.metadata.id}`);
  });

  console.log('Scheduler running — daily at 2 AM');
}

start();
```

---

## Troubleshooting

**First step, always:**

```bash
npx dbdock test
```

This tests your database, storage, and alert config in one go.

### pg_dump / pg_restore / psql not found

You need PostgreSQL client tools installed:

```bash
brew install postgresql          # macOS
sudo apt-get install postgresql-client  # Ubuntu/Debian
```

### Can't connect to database

- Double-check `host`, `port`, `username`, `password`, `database` in config
- Test manually: `psql -h HOST -p PORT -U USERNAME -d DATABASE`
- Make sure the PostgreSQL server is actually running
- Check firewalls / security groups if it's a remote database

### Storage errors

**S3:** Check credentials, bucket name, region. IAM user needs `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject`.

**R2:** Check endpoint format (`https://ACCOUNT_ID.r2.cloudflarestorage.com`), verify API token and bucket exist.

**Cloudinary:** Verify cloud name, API key, API secret. Make sure the account is active.

### Encryption key issues

Key must be exactly 64 hex characters. Generate a valid one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### No backups found during restore

- **Local:** Check the configured path has files
- **S3/R2:** Files should be in `dbdock_backups/` folder
- **Cloudinary:** Check Media Library for `dbdock_backups` folder
- Files should match: `backup-*.sql`

---

## Links

- [npm Package](https://www.npmjs.com/package/dbdock)
- [Full Documentation](https://dbdock.mintlify.app)
- [GitHub](https://github.com/naheemolaide/dbdock-support)
- [Discussions](https://github.com/naheemolaide/dbdock-support/discussions)
- [Report Issues](https://github.com/naheemolaide/dbdock-support/issues)

## License

MIT
