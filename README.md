<div align="center">

# DBDock

DBDock shows what changed in your database, who changed it, and lets you put it back. Your database URL stays on your machine or CI.

[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![npm downloads](https://img.shields.io/npm/dm/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Documentation](https://img.shields.io/badge/docs-docs.dbdock.xyz-23517c)](https://docs.dbdock.xyz)

[Documentation](https://docs.dbdock.xyz) &nbsp;·&nbsp; [Dashboard](https://dbdock.xyz) &nbsp;·&nbsp; [Discussions](https://github.com/dbdock/dbdock/discussions) &nbsp;·&nbsp; [Report a bug](https://github.com/dbdock/dbdock/issues)

</div>

---

Set it up once in your project, then run your migrations the way you already do:

```bash
npm install --save-dev dbdock
npx dbdock init        # runs your migration scripts through DBDock and adds dbdock.config.ts
npm run db:migrate     # your own script: a checkpoint is saved first, then the migration runs
```

`init` finds the package.json scripts that run Prisma, Drizzle, Knex, Sequelize, TypeORM, node-pg-migrate, MikroORM or db-migrate, and puts `dbdock run --` in front of the tool. See [Project setup](#project-setup). To see changes on the dashboard, also run `npx dbdock login` and `npx dbdock link`.

You can also run DBDock directly. `npx dbdock run` with no command runs `prisma migrate deploy` or `drizzle-kit migrate` when the project uses Prisma or Drizzle. For anything else, pass the command: `npx dbdock run -- <your migration command>`.

Set `DATABASE_URL` or `DBDOCK_DB_URL` in the local environment or private `.env` file. The guard supports PostgreSQL, MySQL and MariaDB and refuses the change if its checkpoint or initial local record cannot be saved. Use `dbdock run --sql migration.sql` for SQL files.

Checkpoints default to `.dbdock/checkpoints/` or use your own S3/R2 bucket. CI requires a bucket or `DBDOCK_CHECKPOINT_DIR` on an explicitly mounted persistent volume. Local and customer-bucket checkpoints are outside Cloud backup limits and support your own encryption key on every plan.

The linked dashboard receives one completed record: time, person or agent, deploy or session, operation summary, status and checkpoint ID. It does not receive your URL, credentials, SQL, row data or checkpoint files. Offline records remain in `.dbdock/records/`; `dbdock sync` retries uploads without running the change again. Existing `dbdock.config.json` users also retain optional non-secret configuration sync.

```bash
npx dbdock changes   # what changed, who changed it, and the checkpoint saved before it
npx dbdock undo      # put the database back to the checkpoint before the last change
```

`undo` shows what it will replace and what it will leave alone, then asks. Without a terminal, as in CI, add `--yes`. To go back further, pass a checkpoint: `npx dbdock undo cp_CHECKPOINT_ID`. Use the same target, storage and encryption key that saved it.

Restoring a checkpoint removes writes made after the checkpoint. DBDock saves another checkpoint first, so running `undo` again puts them back. It only replaces the schemas the checkpoint holds; platform schemas such as Supabase's `auth` and `storage` are never touched. Stop other writers during restore.

Only changes through the guard are recorded. A command must use the same target as DBDock; the wrapper cannot inspect another tool's settings. An agent with direct database access can bypass the guard. Existing backup, copy, migration and Cloud connection tools remain available separately.

## Table of contents

- [Install](#install)
- [Project setup](#project-setup)
- [Features](#features)
- [Existing backup tools](#existing-backup-tools)
- [Commands](#commands)
- [Cloud records and optional configuration sync](#cloud-records-and-optional-configuration-sync)
- [Cross-database migration](#cross-database-migration)
- [Storage providers](#storage-providers)
- [Programmatic usage (SDK)](#programmatic-usage-sdk)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Install

**With npx (no install):**

```bash
npx dbdock --help
```

**Global install:**

```bash
npm install -g dbdock
```

**Prerequisites:** Node.js 20+. For PostgreSQL backups you'll need the PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`). MySQL/MariaDB, SQL Server, and Redis backups use their respective client tools.

<details>
<summary>Install PostgreSQL client tools</summary>

`pg_dump` refuses to dump a server newer than itself, so install a client whose
**major version is at or above your server's**. replace `18` below with your
server major if it is higher. dbdock finds every installed client and uses the
newest one, so keeping older majors around is harmless.

```bash
# macOS
brew install postgresql@18

# Ubuntu/Debian (via the PGDG repo: https://www.postgresql.org/download/linux/ubuntu/)
sudo apt-get install postgresql-client-18

# RHEL/Fedora
sudo dnf install postgresql18

# Windows
# Download from https://www.postgresql.org/download/windows/
```

If your client lives somewhere dbdock does not look, point it there directly:

```bash
export DBDOCK_PG_BIN_DIR=/usr/lib/postgresql/18/bin
```
</details>

## Project setup

`npx dbdock init` shows what it will change and asks first (add `--yes` in scripts):

```diff
- "db:migrate": "prisma migrate deploy"
+ "db:migrate": "dbdock run -- prisma migrate deploy"
- "build": "prisma generate && prisma migrate deploy && next build"
+ "build": "prisma generate && dbdock run -- prisma migrate deploy && next build"
```

Only `dbdock run -- ` is inserted. Environment prefixes stay in front, so DBDock sees the same environment as the tool: `dotenv -e .env.production -- dbdock run -- prisma migrate deploy`. Commands that only read, such as `prisma migrate status`, are left alone. If no script runs a migration but the project uses Prisma or Drizzle, `init` adds a `db:migrate` script. `npx dbdock init --remove` takes DBDock back out of the scripts.

Running the tool directly, as in `npx prisma migrate deploy`, skips DBDock: only the scripts are wrapped.

`init` also creates `dbdock.config.ts` (or `dbdock.config.mjs` without TypeScript):

```typescript
import { defineConfig } from 'dbdock/config';

export default defineConfig({
  // The database your migrations change. Default: DATABASE_URL or DBDOCK_DB_URL.
  database: process.env.DATABASE_URL,
  // Default: local disk, in .dbdock/checkpoints. In CI, use your own bucket:
  checkpoints: {
    storage: 's3', // or 'r2', or 'local'
    bucket: 'my-checkpoints',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
  // 64 hex characters. Default: DBDOCK_ENCRYPTION_SECRET.
  encryptionKey: process.env.DBDOCK_ENCRYPTION_SECRET,
  // false runs the wrapped scripts without DBDock, e.g. !process.env.CI
  enabled: true,
});
```

`.env` is loaded before the file runs. A misspelled option, or an option whose environment variable is not set where the script runs, stops the script with the file's name before anything changes. Projects without a config file keep working from `dbdock.config.json` or environment variables.

Scripts that run in CI or on a host (`build`, `vercel-build`, `deploy`, ...) need a bucket there, or `enabled: false` there. Otherwise DBDock refuses to save a local checkpoint in CI and stops the script before the migration.

To run migrations from code, such as a migration script run once per deploy, wrap the call:

```typescript
import { guard } from 'dbdock';

await guard(() => migrate(db, { migrationsFolder: './drizzle' }), {
  // Optional: skip the checkpoint when nothing is pending.
  when: async () => (await pendingMigrations()).length > 0,
});
```

Run it from one place. Two guarded changes at once collide on DBDock's database lock, and the second throws.

## Features

- **Backups & restores**. PostgreSQL, MySQL/MariaDB, SQL Server, and Redis, with encryption and compression
- **Database copies**. clone prod → staging → local with a single command
- **Cross-database migration**. MongoDB ↔ PostgreSQL with schema mapping, dry runs, and incremental sync
- **Multi-cloud storage**. local disk, AWS S3, Cloudflare R2, Cloudinary. swap with one line
- **Cloud Sync**. link a project to [DBDock Cloud](https://dbdock.xyz) and monitor from the dashboard
- **Security-first**. AES-256-GCM encryption, env-var secrets, credential masking, `.pgpass` support
- **Retention policies**. auto-cleanup by count or age, with a safety net
- **Alerts & schedules**. email and Slack notifications, cron-based automation
- **TypeScript SDK**. use DBDock programmatically in any Node.js app
- **MIT licensed**. free forever, self-hosted, no vendor lock-in

## Existing backup tools

```bash
npx dbdock init --backups   # Interactive setup (30 seconds)
npx dbdock test      # Validate connections
npx dbdock backup    # Create your first backup
npx dbdock restore   # Interactive restore
```

See the [Quickstart guide](https://docs.dbdock.xyz/get-started/quickstart) for a full walkthrough.

## Commands

| Command | Purpose |
|---|---|
| `run` | Save a checkpoint, run your migration or SQL file, and keep a record |
| `undo` | Put the database back to the checkpoint before the last change |
| `changes` | List recent changes, who made them and their checkpoints |
| `link` | Link this directory without a database URL |
| `init` | Run this project's migration scripts through DBDock and add `dbdock.config.ts`. `--remove` undoes it; `--backups` opens the backup setup wizard |
| [`backup`](https://docs.dbdock.xyz/cli/backup) | Create a backup |
| [`restore`](https://docs.dbdock.xyz/cli/restore) | Restore a backup (with filtering), or a checkpoint by ID |
| [`copydb`](https://docs.dbdock.xyz/cli/copydb) | Copy a database between two URLs |
| [`list`](https://docs.dbdock.xyz/cli/list) | List backups |
| [`delete`](https://docs.dbdock.xyz/cli/delete) | Delete specific or all backups |
| [`cleanup`](https://docs.dbdock.xyz/cli/cleanup) | Apply retention policy |
| [`schedule`](https://docs.dbdock.xyz/cli/schedule) | Manage cron schedules |
| [`status`](https://docs.dbdock.xyz/cli/status) | View configured schedules |
| [`test`](https://docs.dbdock.xyz/cli/test) | Validate configuration |
| [`analyze`](https://docs.dbdock.xyz/migration/analyze) | Inspect a database structure |
| [`migrate`](https://docs.dbdock.xyz/migration/migrate) | Cross-database migration |
| [`migrate-config`](https://docs.dbdock.xyz/cli/migrate-config) | Move legacy secrets to env vars |
| [`login`](https://docs.dbdock.xyz/cli/login) | Sign in to DBDock Cloud (also `logout`, `whoami`) |
| [`sync`](https://docs.dbdock.xyz/cli/sync) | Sync this project with the cloud |
| [`open`](https://docs.dbdock.xyz/cli/open) | Open this project in the dashboard |
| [`account`](https://docs.dbdock.xyz/cli/account) | Show your plan and usage limits |
| [`storage`](https://docs.dbdock.xyz/cli/storage) | Show DBDock managed storage usage and quota |
| [`alert`](https://docs.dbdock.xyz/cli/alert) | Manage cloud alert channels and rules |

Full reference at [docs.dbdock.xyz/cli/overview](https://docs.dbdock.xyz/cli/overview).

## Cloud records and optional configuration sync

Link a local project to your [DBDock Cloud](https://dbdock.xyz) dashboard so you can automate from the terminal and monitor from the browser.

```bash
npx dbdock login
npx dbdock link
npx dbdock sync
npx dbdock open --print
```

Completed guard records contain no database URL, raw SQL or row data. Existing `dbdock.config.json` users also retain non-secret configuration sync, including host and database names. See [Data handling](https://docs.dbdock.xyz/cloud-sync/data-handling) for the exact contract.

## Cross-database migration

MongoDB → PostgreSQL or PostgreSQL → MongoDB, with automatic schema mapping, dry runs, and incremental sync.

```bash
npx dbdock analyze "mongodb://localhost:27017/myapp"       # Inspect first
npx dbdock migrate "mongo_url" "postgres_url" --dry-run    # Validate
npx dbdock migrate "mongo_url" "postgres_url"              # Run it
```

See [docs.dbdock.xyz/migration](https://docs.dbdock.xyz/migration/overview).

## Storage providers

These destinations apply to existing backup commands. The guard supports local disk and your S3/R2 bucket:

- [DBDock Storage](https://docs.dbdock.xyz/storage/managed). managed, zero setup, included with your plan (recommended)
- [Local disk](https://docs.dbdock.xyz/storage/local). fastest, single server
- [AWS S3](https://docs.dbdock.xyz/storage/s3). industry standard, any S3-compatible service
- [Cloudflare R2](https://docs.dbdock.xyz/storage/r2). zero egress fees
- [Cloudinary](https://docs.dbdock.xyz/storage/cloudinary). generous free tier

Swap providers by changing one line in `dbdock.config.json`.

### DBDock Storage (managed)

Pick **DBDock Storage** in `dbdock init` and your backups upload straight to storage included with your plan. no bucket, no keys. It needs a signed-in account (`dbdock login`); uploads and downloads use short-lived presigned URLs, so your credentials never touch a bucket.

```bash
npx dbdock login       # one-time browser sign-in
npx dbdock init        # choose "DBDock Storage (recommended)"
npx dbdock backup      # uploads to your managed quota
npx dbdock storage     # see how much space you've used
```

## Programmatic usage (SDK)

```typescript
import { runGuardedChange, restoreCheckpoint } from 'dbdock';

const result = await runGuardedChange(() => runYourMigration(), {
  kind: 'migration',
  actor: 'Release runner',
});
await restoreCheckpoint(result.record.checkpointId, {
  confirmLaterWrites: true,
});
```

`runYourMigration` is your own function and must use the same local target. Ask the operator to confirm removal of later writes before restoring. Existing SDK backup functions remain available:


```javascript
const { createDBDock, BackupService } = require('dbdock');

const dbdock = await createDBDock();
const backups = dbdock.get(BackupService);

const result = await backups.createBackup({
  compress: true,
  encrypt: true,
});

console.log(`Backup ${result.metadata.id}. ${result.metadata.formattedSize}`);
```

Full SDK reference at [docs.dbdock.xyz/sdk](https://docs.dbdock.xyz/sdk/overview).

## Security

- Secrets live in environment variables, never in `dbdock.config.json`
- AES-256-GCM encryption with PBKDF2 key derivation
- Credential masking in logs
- `.pgpass` support for host-level credential isolation
- Strict mode (`DBDOCK_STRICT_MODE=true`) refuses any config file that contains secrets
- Cloud Sync uploads metadata only. never credentials

See [docs.dbdock.xyz/security](https://docs.dbdock.xyz/security/overview) and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

### Contributors

Thanks to everyone who has contributed to DBDock:

<a href="https://github.com/dbdock/dbdock/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=dbdock/dbdock" alt="DBDock contributors" />
</a>

Created and maintained by [Naheem Olaide](https://github.com/appdever01).

## License

[MIT](LICENSE). free forever, self-hosted, no vendor lock-in.
