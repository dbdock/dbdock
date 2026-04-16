# DBDock

Stop writing backup scripts. Stop losing sleep over database migrations. DBDock handles PostgreSQL backups, restores, database copies, and cross-database migrations between MongoDB and PostgreSQL in one command.

[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Documentation](https://img.shields.io/badge/docs-dbdock.mintlify.app-blue)](https://dbdock.mintlify.app)

[Full Docs](https://dbdock.mintlify.app) ・ [Discussions](https://github.com/dbdock/dbdock/discussions) ・ [Report a Bug](https://github.com/dbdock/dbdock/issues)

---

## The Problem

Every time you need to backup a database, copy it to staging, or restore before a migration — it's the same boring steps. Connect, dump, upload, move files around, remember the right flags. Sure, you could ask AI to write you a script. But then you're maintaining that script, handling errors, adding encryption, switching storage providers, doing it again next week.

It's not hard. It's just repetitive. And repetitive stuff should be one command.

## The Fix

```bash
npx dbdock init                              # One-time setup (takes 30 seconds)
npx dbdock backup                            # Backup with encryption + compression
npx dbdock restore                           # Restore from any backup
npx dbdock copydb "db_url_1" "db_url_2"      # Copy entire database, zero config
npx dbdock migrate "mongo_url" "postgres_url" # Cross-database migration
```

That's it. No shell scripts. No manual uploads. No throwaway migration code.

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

You can also run **without a config file**: set `DBDOCK_DB_URL` (or `DATABASE_URL`) and other env vars and DBDock will use env-only configuration.

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

## Cross-Database Migration (MongoDB ↔ PostgreSQL)

Move your data between MongoDB and PostgreSQL without writing throwaway scripts. DBDock analyzes the source, proposes a schema mapping, lets you review it, and handles the transfer.

### `dbdock analyze` — Understand your database first

```bash
npx dbdock analyze "mongodb://localhost:27017/myapp"
npx dbdock analyze "postgresql://user:pass@localhost:5432/myapp"
```

Scans the source database and shows you everything — collections/tables, field types, nested structures, inconsistencies (like a `price` field that's a string in 200 docs and a number in 15,000), and missing fields.

```
  DBDock - Database Analysis
  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─

ℹ Database: MongoDB — myapp
ℹ Host: localhost:27017

✓ Analysis complete

  Found 4 collections, 57.2K total documents

  users (45K docs)
  ├─ _id (objectId)
  ├─ name (string)
  ├─ email (string)
  ├─ address (object)
  │   ├─ street (string)
  │   ├─ city (string)
  │   └─ zip (string)
  ├─ phone (string) [62% present]
  └─ orders (array: object)

  products (12K docs)
  ├─ _id (objectId)
  ├─ title (string)
  ├─ price (string(203), number(11797)) ⚠ mixed types
  ├─ tags (array: string)
  └─ meta (object)
```

---

### `dbdock migrate` — Cross-database migration

```bash
npx dbdock migrate "mongodb://localhost:27017/myapp" "postgresql://user:pass@localhost:5432/myapp"
```

DBDock analyzes the source, generates a schema mapping proposal, and presents it for review before touching anything:

```
  DBDock - Cross-Database Migration
  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─

ℹ Source: MongoDB — myapp
ℹ Target: PostgreSQL — myapp

✓ Source analyzed: 4 collections, 57.2K documents

  Proposed Schema Mapping:

  users → users
  ├─ _id → (uuid_from_objectid) users.id (uuid) PK
  ├─ name → users.name (text)
  ├─ email → users.email (text)
  ├─ address {} → user_addresses (1:1 relation)
  │   ├─ street → street (text)
  │   ├─ city → city (text)
  │   └─ zip → zip (text)
  ├─ orders [] → user_orders child table

  products → products
  ├─ _id → (uuid_from_objectid) products.id (uuid) PK
  ├─ title → products.title (text)
  ├─ price → products.price (numeric) nullable
  ├─ tags [] → product_tags text[]
  ├─ meta {} → products.meta (jsonb)

  ⚠ Conflicts Found:

  • products.price: string in 203 docs, number in 11797 docs
    → Suggestion: cast to numeric, log failures

  • users.phone: missing in 38.0% of documents
    → Suggestion: nullable column

? Accept mapping? (Y / export / cancel)
```

You review the mapping, then choose: execute it, export it as a config file to tweak, or cancel.

---

### What it handles

| Scenario | How DBDock handles it |
|---|---|
| **Nested objects** | Consistent shape → flattened to a related table. Varying/messy → kept as `jsonb` column |
| **Arrays of primitives** | `tags: ["a", "b"]` → PostgreSQL array column or junction table |
| **Arrays of objects** | `orders: [{item, qty}]` → child table with foreign key back to parent |
| **Missing fields** | Detects frequency across all documents, makes sparse fields nullable |
| **Type mismatches** | Same field with different types → casts to majority type, logs failures to `_migration_errors` |
| **ObjectId references** | Auto-detects `userId: ObjectId(...)` patterns → creates proper foreign keys |
| **Deep nesting** | Flattens up to configurable depth (default: 2), stores deeper levels as `jsonb` |
| **Postgres → Mongo** | 1:1 joins → embedded objects. Small 1:many → embedded arrays. Large 1:many → separate collections with refs |
| **Many-to-many** | Junction tables → arrays of values in the document |

---

### The reverse — PostgreSQL to MongoDB

```bash
npx dbdock migrate "postgresql://user:pass@localhost:5432/myapp" "mongodb://localhost:27017/myapp"
```

DBDock detects table relationships and proposes embedding vs referencing strategies:

```
  Proposed Document Mapping:

  users → users collection
  ├─ id → _id
  ├─ name → name
  ├─ email → email
  ├─ addresses → embed object as address
  ├─ orders → embed array as orders (< 1000 rows)

  products → products collection
  ├─ id → _id
  ├─ title → title
  ├─ price → price
  ├─ product_tags → embed as tags array
```

Small 1:1 and 1:many relations get embedded. Large 1:many relations stay as separate collections with reference fields. You can override per table.

---

### Dry run & validation

```bash
npx dbdock migrate --dry-run "mongodb://..." "postgresql://..."
```

Runs the full migration into a temporary schema, validates counts and referential integrity, then cleans up. Nothing touches the real target:

```
  Dry Run Results:
  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─
  ✔ users:        45,000 → 45,000
  ✔ addresses:    45,000 → 44,998 (2 failed)
  ✔ orders:      312,400 → 312,400
  ✔ products:     12,000 → 12,000
  ✔ product_tags: 38,200 → 38,200

  ⚠ 2 rows failed (see _migration_errors)
  ✓ All foreign keys valid — dry run passed
```

---

### Incremental / delta migration

Already migrated once but your app is still running on the old database? Sync only new or changed data:

```bash
npx dbdock migrate --incremental --since "2026-03-10" "mongodb://..." "postgresql://..."
```

Uses `createdAt`/`updatedAt` timestamps to only transfer new and changed documents. Existing rows in the target are upserted.

---

### Save & reuse config

Export the mapping for your team to use reproducibly:

```bash
npx dbdock migrate --export-config ./migration.yaml "mongodb://..." "postgresql://..."
```

Then anyone runs the same migration:

```bash
npx dbdock migrate --config ./migration.yaml "mongodb://..." "postgresql://..."
```

Tweak the YAML/JSON config to adjust type mappings, embedding strategies, or rename target tables — then re-run.

---

### Migration options

| Flag | What it does |
|---|---|
| `--dry-run` | Migrate into temp schema, validate, clean up |
| `--incremental` | Only sync new/changed data |
| `--since <date>` | Cutoff date for incremental mode (ISO format) |
| `--config <path>` | Load a saved migration config (YAML or JSON) |
| `--export-config <path>` | Save migration plan to file without executing |
| `--batch-size <n>` | Documents per batch (default: 1000) |
| `--max-depth <n>` | Max nesting depth before storing as jsonb (default: 2) |

### Core principles

- **Never lose data** — failed rows go to `_migration_errors`, never silently dropped
- **Never surprise the user** — full mapping shown before execution, conflicts flagged
- **Always let you review** — nothing executes without explicit confirmation
- **Reproducible** — export/import configs for team-wide consistency

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
| Host, port, bucket names, settings | `dbdock.config.json` or env | Yes (if in config) |
| Passwords, API keys, secrets | `.env` or `DBDOCK_DB_URL` | No (auto-gitignored) |

### Environment Variables

Use either a **full database URL** or **separate credentials**:

```bash
# Option 1: Full URL (env-only config, no password var needed)
DBDOCK_DB_URL=postgresql://user:password@host:5432/database
# or DATABASE_URL=postgresql://user:password@host:5432/database

# Option 2: Separate credentials (with or without dbdock.config.json)
DBDOCK_DB_PASSWORD=your-database-password           # Required if not using URL
DBDOCK_STORAGE_ACCESS_KEY=your-access-key            # For cloud storage
DBDOCK_STORAGE_SECRET_KEY=your-secret-key            # For cloud storage
DBDOCK_ENCRYPTION_SECRET=64-char-hex-string          # If encryption enabled
DBDOCK_SMTP_USER=your-email@example.com              # For email alerts
DBDOCK_SMTP_PASS=your-app-password                   # For email alerts
DBDOCK_SLACK_WEBHOOK=https://hooks.slack.com/...     # For Slack alerts
```

When `DBDOCK_DB_URL` or `DATABASE_URL` is set, it overrides database settings from `dbdock.config.json`. You can run with **env-only** (no config file) by setting the URL plus storage/encryption/alert vars in `.env`. Reads from both `.env` and `.env.local` (`.env.local` takes priority).

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

Use `dbdock.config.json` (run `npx dbdock init`) or configure entirely via env vars (`DBDOCK_DB_URL` / `DATABASE_URL` plus storage and other env vars).

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
- [GitHub](https://github.com/dbdock/dbdock)
- [Discussions](https://github.com/dbdock/dbdock/discussions)
- [Report Issues](https://github.com/dbdock/dbdock/issues)

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines. For security issues, see [SECURITY.md](SECURITY.md).

### Contributors

Thanks to everyone who has contributed to DBDock:

<a href="https://github.com/dbdock/dbdock/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=dbdock/dbdock" alt="DBDock contributors" />
</a>

Created and maintained by [Naheem Olaide](https://github.com/appdever01).

## License

MIT
