# DBdock

The open-source database CLI for PostgreSQL backups, restores, database copies, and cross-database migrations between MongoDB and PostgreSQL — with encryption, compression, and multi-cloud storage built in.

[![npm version](https://img.shields.io/npm/v/dbdock.svg)](https://www.npmjs.com/package/dbdock)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Documentation](https://img.shields.io/badge/docs-docs.dbdock.xyz-blue)](https://docs.dbdock.xyz)

[Documentation](https://docs.dbdock.xyz) ・ [Discussions](https://github.com/dbdock/dbdock/discussions) ・ [Report a Bug](https://github.com/dbdock/dbdock/issues)

---

Stop writing backup scripts. Stop maintaining migration code. One CLI, one command.

```bash
npx dbdock init                               # One-time setup
npx dbdock backup                             # Backup with encryption + compression
npx dbdock restore                            # Interactive restore
npx dbdock copydb "src_url" "dst_url"         # Copy a database, zero config
npx dbdock migrate "mongo_url" "postgres_url" # Cross-database migration
```

## Install

**With npx (no install):**

```bash
npx dbdock --help
```

**Global install:**

```bash
npm install -g dbdock
```

**Prerequisites:** Node.js 18+ and PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`).

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

- **Beautiful CLI** — real-time progress bars, speed tracking, smart filtering
- **Multiple storage** — local disk, AWS S3, Cloudflare R2, Cloudinary
- **Security-first** — AES-256-GCM encryption, env-var secrets, credential masking, `.pgpass` support
- **Retention policies** — auto-cleanup by count/age with a safety net
- **Alerts** — email (SMTP) and Slack for backup success and failure
- **Cron schedules** — automated backups
- **Cross-database** — MongoDB ↔ PostgreSQL with schema mapping and dry runs
- **TypeScript SDK** — use DBdock programmatically in any Node.js app

## Quick start

```bash
npx dbdock init      # Interactive setup (30 seconds)
npx dbdock test      # Validate connections
npx dbdock backup    # Create your first backup
npx dbdock restore   # Interactive restore
```

See the [Quickstart guide](https://docs.dbdock.xyz/get-started/quickstart) for a full walkthrough.

## Commands at a glance

| Command | Purpose |
|---|---|
| [`init`](https://docs.dbdock.xyz/cli/init) | Interactive setup wizard |
| [`backup`](https://docs.dbdock.xyz/cli/backup) | Create a backup |
| [`restore`](https://docs.dbdock.xyz/cli/restore) | Restore a backup (with filtering) |
| [`copydb`](https://docs.dbdock.xyz/cli/copydb) | Copy a database between two URLs |
| [`list`](https://docs.dbdock.xyz/cli/list) | List backups |
| [`delete`](https://docs.dbdock.xyz/cli/delete) | Delete specific or all backups |
| [`cleanup`](https://docs.dbdock.xyz/cli/cleanup) | Apply retention policy |
| [`schedule`](https://docs.dbdock.xyz/cli/schedule) | Manage cron schedules |
| [`status`](https://docs.dbdock.xyz/cli/status) | View schedules and service health |
| [`test`](https://docs.dbdock.xyz/cli/test) | Validate configuration |
| [`analyze`](https://docs.dbdock.xyz/migration/analyze) | Inspect a database structure |
| [`migrate`](https://docs.dbdock.xyz/migration/migrate) | Cross-database migration |
| [`migrate-config`](https://docs.dbdock.xyz/cli/migrate-config) | Move legacy secrets to env vars |

Full reference at [docs.dbdock.xyz/cli/overview](https://docs.dbdock.xyz/cli/overview).

## Cross-database migration

MongoDB → PostgreSQL or PostgreSQL → MongoDB with automatic schema mapping, dry runs, and incremental sync.

```bash
npx dbdock analyze "mongodb://localhost:27017/myapp"       # Inspect first
npx dbdock migrate "mongo_url" "postgres_url" --dry-run    # Validate
npx dbdock migrate "mongo_url" "postgres_url"              # Run it
```

See [docs.dbdock.xyz/migration](https://docs.dbdock.xyz/migration/overview).

## Storage providers

DBdock writes backups to your storage of choice:

- [Local disk](https://docs.dbdock.xyz/storage/local) — fastest, single server
- [AWS S3](https://docs.dbdock.xyz/storage/s3) — industry standard, any S3-compatible service
- [Cloudflare R2](https://docs.dbdock.xyz/storage/r2) — zero egress fees
- [Cloudinary](https://docs.dbdock.xyz/storage/cloudinary) — generous free tier

Swap providers by changing one line in `dbdock.config.json`.

## Programmatic usage

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

See [docs.dbdock.xyz/core/security](https://docs.dbdock.xyz/core/security) and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

### Contributors

Thanks to everyone who has contributed to DBdock:

<a href="https://github.com/dbdock/dbdock/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=dbdock/dbdock" alt="DBdock contributors" />
</a>

Created and maintained by [Naheem Olaide](https://github.com/appdever01).

## License

[MIT](LICENSE) — free forever, self-hosted, no vendor lock-in.
