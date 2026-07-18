<div align="center">

# DBDock

**The database toolkit for backups, restores, copies, and cross-database migrations — with encryption, compression, and multi-cloud storage built in.**

[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![npm downloads](https://img.shields.io/npm/dm/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Documentation](https://img.shields.io/badge/docs-docs.dbdock.xyz-23517c)](https://docs.dbdock.xyz)

[Documentation](https://docs.dbdock.xyz) &nbsp;·&nbsp; [Dashboard](https://dbdock.xyz) &nbsp;·&nbsp; [Discussions](https://github.com/dbdock/dbdock/discussions) &nbsp;·&nbsp; [Report a bug](https://github.com/dbdock/dbdock/issues)

</div>

---

Stop writing throwaway backup scripts. Stop maintaining migration code. One CLI, one command.

```bash
npx dbdock init                               # One-time setup
npx dbdock backup                             # Backup with encryption + compression
npx dbdock restore                            # Interactive restore
npx dbdock copydb "src_url" "dst_url"         # Copy a database, zero config
npx dbdock migrate "mongo_url" "postgres_url" # Cross-database migration
npx dbdock login && npx dbdock sync           # Link this project to DBDock Cloud
```

> **Two ways to use DBDock.** This CLI is the open-source, self-hosted half. There's also [**DBDock Cloud**](https://dbdock.xyz) — a managed dashboard with scheduled jobs, managed storage, teams, and alerts. [**Cloud Sync**](https://docs.dbdock.xyz/cloud-sync/overview) links the two, and only non-secret metadata ever leaves your machine.

## Table of contents

- [Install](#install)
- [Features](#features)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Cloud Sync](#cloud-sync)
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

**Prerequisites:** Node.js 18+. For PostgreSQL backups you'll need the PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`). MySQL/MariaDB, SQL Server, and Redis backups use their respective client tools.

<details>
<summary>Install PostgreSQL client tools</summary>

```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql-client

# Windows
# Download from https://www.postgresql.org/download/windows/
```
</details>

## Features

- **Backups & restores** — PostgreSQL, MySQL/MariaDB, SQL Server, and Redis, with encryption and compression
- **Database copies** — clone prod → staging → local with a single command
- **Cross-database migration** — MongoDB ↔ PostgreSQL with schema mapping, dry runs, and incremental sync
- **Multi-cloud storage** — local disk, AWS S3, Cloudflare R2, Cloudinary — swap with one line
- **Cloud Sync** — link a project to [DBDock Cloud](https://dbdock.xyz) and monitor from the dashboard
- **Security-first** — AES-256-GCM encryption, env-var secrets, credential masking, `.pgpass` support
- **Retention policies** — auto-cleanup by count or age, with a safety net
- **Alerts & schedules** — email and Slack notifications, cron-based automation
- **TypeScript SDK** — use DBDock programmatically in any Node.js app
- **MIT licensed** — free forever, self-hosted, no vendor lock-in

## Quick start

```bash
npx dbdock init      # Interactive setup (30 seconds)
npx dbdock test      # Validate connections
npx dbdock backup    # Create your first backup
npx dbdock restore   # Interactive restore
```

See the [Quickstart guide](https://docs.dbdock.xyz/get-started/quickstart) for a full walkthrough.

## Commands

| Command | Purpose |
|---|---|
| [`init`](https://docs.dbdock.xyz/cli/init) | Interactive setup wizard (optionally links to the cloud) |
| [`backup`](https://docs.dbdock.xyz/cli/backup) | Create a backup |
| [`restore`](https://docs.dbdock.xyz/cli/restore) | Restore a backup (with filtering) |
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

Full reference at [docs.dbdock.xyz/cli/overview](https://docs.dbdock.xyz/cli/overview).

## Cloud Sync

Link a local project to your [DBDock Cloud](https://dbdock.xyz) dashboard so you can automate from the terminal and monitor from the browser.

```bash
npx dbdock login     # Browser OAuth sign-in
npx dbdock init      # Links this project to the dashboard
npx dbdock sync      # Push local config to the cloud
npx dbdock open      # Open it in the browser
```

**Only non-secret metadata syncs** — database passwords, storage keys, encryption secrets, and webhook URLs never leave your machine. See [Data handling](https://docs.dbdock.xyz/cloud-sync/data-handling) for the exact contract.

## Cross-database migration

MongoDB → PostgreSQL or PostgreSQL → MongoDB, with automatic schema mapping, dry runs, and incremental sync.

```bash
npx dbdock analyze "mongodb://localhost:27017/myapp"       # Inspect first
npx dbdock migrate "mongo_url" "postgres_url" --dry-run    # Validate
npx dbdock migrate "mongo_url" "postgres_url"              # Run it
```

See [docs.dbdock.xyz/migration](https://docs.dbdock.xyz/migration/overview).

## Storage providers

DBDock writes backups to your storage of choice:

- [Local disk](https://docs.dbdock.xyz/storage/local) — fastest, single server
- [AWS S3](https://docs.dbdock.xyz/storage/s3) — industry standard, any S3-compatible service
- [Cloudflare R2](https://docs.dbdock.xyz/storage/r2) — zero egress fees
- [Cloudinary](https://docs.dbdock.xyz/storage/cloudinary) — generous free tier

Swap providers by changing one line in `dbdock.config.json`.

## Programmatic usage (SDK)

```javascript
const { createDBDock, BackupService } = require('dbdock');

const dbdock = await createDBDock();
const backups = dbdock.get(BackupService);

const result = await backups.createBackup({
  compress: true,
  encrypt: true,
});

console.log(`Backup ${result.metadata.id} — ${result.metadata.formattedSize}`);
```

Full SDK reference at [docs.dbdock.xyz/sdk](https://docs.dbdock.xyz/sdk/overview).

## Security

- Secrets live in environment variables, never in `dbdock.config.json`
- AES-256-GCM encryption with PBKDF2 key derivation
- Credential masking in logs
- `.pgpass` support for host-level credential isolation
- Strict mode (`DBDOCK_STRICT_MODE=true`) refuses any config file that contains secrets
- Cloud Sync uploads metadata only — never credentials

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

[MIT](LICENSE) — free forever, self-hosted, no vendor lock-in.
