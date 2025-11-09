# DBDock PRD v1 for NestJS

## Summary

DBDock is a developer first database backup and restore platform built as a NestJS service and a pnpm package. The goal is a small scalable core that any project can install and configure to perform secure automated Postgres backups, upload them to object storage, and restore to any saved point in time in the future. The codebase will be modular so support for other database engines can be added later with minimal friction.

## Vision

Make backups boring and reliable. Install once, configure once, then forget about losing production data. Developers get a single API and a CLI to create backups, manage retention, and run restores to a specific timestamp.

## Goals for v1

1. Provide reliable full backup for Postgres using pg dump or pg basebackup where appropriate.
2. Provide WAL archiving to support point in time recovery within configured retention.
3. Encrypt and compress backups before upload.
4. Upload backups to S3 compatible storage such as Cloudflare R2 or AWS S3 and to local filesystem for tests.
5. Provide CLI and programmatic API for backup and restore operations.
6. Provide scheduler support for cron style expressions and human intervals.
7. Send email alerts via SMTP after backup success or failure.
8. Expose a clean module structure in NestJS that allows zero friction for adding new storage adapters and new database engines.

## Success metrics

* Installation to first backup success rate above 90 percent.
* Restore verification pass rate above 95 percent when run in staging.
* Average time to create compressed encrypted backup for 1 gigabyte sized database below 90 seconds using standard cloud network.

## Audience

* Node and NestJS developers building SaaS applications.
* Early stage teams with limited ops staff.
* Freelance backend engineers managing multiple client databases.

## Scope for v1

Included

* Full logical backup via pg dump with options for custom flags.
* WAL archiving that uploads WAL segments to object storage continuously or in small intervals.
* Streaming compression and encryption pipeline to avoid writing plain files to disk when possible.
* Storage adapters for S3 compatible storage and local filesystem.
* Simple CLI commands: init, backup now, start scheduler, restore to time, list backups.
* Programmatic API export so other apps can call DBDock as a library.
* SMTP email alerts on success or failure.
* Retention manager that prunes old base backups and WAL segments.

Out of scope for v1

* Web dashboard.
* Multi tenant management.
* Other database engines until after core is stable.

## Architecture overview

# Core concepts

1. Agent service

* A NestJS service that can run as a daemon inside a container or as a standalone process. It exposes a local HTTP control API and a CLI interface.

2. Backup runner

* A pipeline that performs dump or basebackup, compresses, encrypts, and uploads to a storage adapter.

3. WAL archiver

* A process that watches Postgres WAL output directory or receives WAL stream and uploads segments to storage with metadata for replay.

4. Restore engine

* A component that given a target timestamp will pick the right base backup and download WAL segments up to the target timestamp then perform replay to restore the database to that exact time.

5. Storage adapters

* Implement a simple interface with methods: uploadStream, listObjects, downloadStream, deleteObject, generatePresignedUrl.

6. Config manager

* Validates config, supports env variables and a config file, supports secrets injection from common secret stores later.

7. Scheduler

* Cron based scheduler with support for human friendly intervals such as every 6 hours every day at 02 00 etc.

8. Notifier

* Nodemailer based SMTP notifier module.

## NestJS module layout

Project source layout using TypeScript

```
src/
  app.module.ts
  main.ts
  config/
    config.module.ts
    config.service.ts
  backup/
    backup.module.ts
    backup.service.ts
    backup.controller.ts
    backup.runner.ts
  wal/
    wal.module.ts
    wal.service.ts
    wal.archiver.ts
  restore/
    restore.module.ts
    restore.service.ts
    restore.runner.ts
  storage/
    storage.module.ts
    adapters/
      s3.adapter.ts
      r2.adapter.ts
      local.adapter.ts
    storage.interface.ts
  crypto/
    crypto.module.ts
    encryptor.ts
    keyderivation.ts
  scheduler/
    scheduler.module.ts
    scheduler.service.ts
  notifier/
    notifier.module.ts
    mailer.service.ts
  cli/
    cli.module.ts
    cli.commands.ts
  utils/
    stream.pipe.ts
    logger.ts

```

Notes

* Each module uses dependency injection so adapters and services can be swapped for tests or different environments.
* The backup runner and wal archiver must be IO efficient and stream oriented to handle large databases without high disk usage.

## Key technical details

### Backup method choices

* Logical backup via pg dump with custom flags for portability and smaller schema aware dumps.
* Physical base backup via pg basebackup for large databases or where PITR will rely on physical state. Use pg basebackup when WAL archiving is enabled and when user opts for base backups.

Decision for v1

* Implement both: default to pg dump for small and medium databases. Support pg basebackup for users who enable PITR and need base images.

### WAL archiving and PITR

* Configure Postgres archive command to point to a local process or path that DBDock manages. The archiver uploads every WAL segment to storage.
* Store metadata about WAL segment times and log sequence numbers so the restore engine can fetch only required segments.
* For streaming WAL replay support use standard Postgres restore tooling that replays WAL files until a stop time specified in recovery.conf style settings.

### Encryption

* Use AES 256 GCM for authenticated encryption.
* Derive a symmetric key via PBKDF2 using a user secret and a per project salt stored in metadata.
* Store encryption metadata next to each object including salt iv tag and algorithm so restore can reconstruct the key.
* Allow a no encryption mode if user explicitly opts out but show warnings.

### Compression

* Use zstd streaming for high ratio and speed.
* Support gzip fallback for environments where zstd is not available.

### Upload and storage

* Use AWS SDK v3 with endpoint override so the same adapter works for R2 or S3.
* Use multipart upload for large files.
* Upload with object metadata that includes backup timestamp database name backup type and checksum.

### Restore algorithm

1. Client requests restore to timestamp T.
2. Restore engine lists base backups and picks the most recent base backup with timestamp <= T.
3. Download base backup and place into restore target directory.
4. Download WAL segments from base backup time up to T.
5. Decrypt and decompress files on the fly while streaming into Postgres restore utilities.
6. Start Postgres in recovery mode and replay WAL until T.
7. Switch to normal mode and report success.

Notes

* For remote restores where the target server is not local the restore runner will stream data across the network. This is supported but less efficient than running the restore on the same local network as the DB.

## CLI design

* Commands to implement

  * npx dbdock init    Creates example config and guides user
  * npx dbdock backup now    Runs one backup immediately
  * npx dbdock wal start    Starts WAL archiver process
  * npx dbdock restore --time "2025 11 09T13 20Z" --target "postgres connection string"    Restore to a timestamp
  * npx dbdock list backups    Lists available backups and WAL snapshots

## Config schema

Use JSON or YAML with validation. Example JSON

```
{
  "postgres": {
    "host": "db host",
    "port": 5432,
    "user": "backup user",
    "password": "secret",
    "database": "appdb"
  },
  "storage": {
    "provider": "r2",
    "endpoint": "https://accountid.r2.cloudflarestorage.com",
    "bucket": "dbdock backups",
    "accessKeyId": "R2 KEY",
    "secretAccessKey": "R2 SECRET"
  },
  "encryption": {
    "enabled": true,
    "secret": "YOUR LONG SECRET",
    "iterations": 100000
  },
  "schedule": {
    "type": "cron",
    "expression": "0 14 * * *"
  },
  "pitr": {
    "enabled": true,
    "wal interval seconds": 300,
    "retention days": 30
  },
  "alerts": {
    "smtpHost": "smtp.mail.com",
    "smtpPort": 587,
    "smtpUser": "noreply@mail.com",
    "smtpPass": "smtp secret",
    "to": ["devops@company.com"]
  }
}
```

Note

* Avoid storing secrets in plaintext in repo. Support env overrides and secret manager integration later.

## Security considerations

* Never log secrets or encryption keys.
* Use least privilege for storage credentials.
* Encryption metadata must be protected and should not leak secret values.
* Provide clear recovery instructions and highlight risk of key loss so users store their secret safely.

## Testing plan

* Unit tests for encryptor compress and storage adapters with mocks.
* Integration tests that run in docker compose with a Postgres instance and local storage adapter.
* Restore validation test that performs full backup and then restore into a fresh DB and verifies row counts and checksums.
* Load test that simulates WAL heavy workloads to validate uploader throughput.

## Observability and logging

* Local JSON logs with structured fields for backups and restores.
* Status events for each backup step to allow building a future dashboard.
* Metrics export via Prometheus friendly endpoint in the agent for backup durations sizes error counts.

## Retention and pruning

* Implement retention policy engine that can keep daily weekly and monthly copies using simple rules and timestamps.
* Wal pruning should remove WAL segments older than retention window while keeping the set needed for restores to the earliest kept base backup.

## API and library surface

* Programmatic API shape

```ts
interface DBDockClientConfig { /* config schema */ }
class DBDockClient {
  constructor(cfg: DBDockClientConfig)
  backupNow(): Promise<BackupMeta>
  startWalArchiver(): Promise<void>
  restoreToTime(t: string, targetConn: string): Promise<RestoreResult>
  listBackups(): Promise<BackupMeta[]>
}
```

## Milestones for v1

* Week 1

  * Project scaffold with NestJS modules and basic config loader
  * Implement storage adapter interface and local adapter
* Week 2

  * Implement logical backup runner using pg dump
  * Add streaming compression and encryption
  * Add upload to storage
* Week 3

  * Implement WAL archiver and metadata tracking
  * Implement retention manager
* Week 4

  * Implement restore engine support for base plus WAL replay to time
  * Add CLI commands and notifier
  * Add integration tests and docs

## Risks and mitigations

* Risk loss of encryption secret leads to permanent data loss

  * Mitigation: force user confirmation step when enabling encryption and show clear copy instructions
* Risk WAL growth can outpace storage bandwidth

  * Mitigation: configurable wal interval compression and optional multi destination upload later
* Risk partial upload corruption

  * Mitigation: multipart upload checksums and post upload verification step

## Next steps

* Approve v1 scope and allocate engineering owner
* Create repo and CI pipeline
* Start week 1 sprint and setup cadence
