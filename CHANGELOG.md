# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `dbdock restore <checkpoint-id>` prints what it will replace and what it will leave alone before it starts, and exits with code 73 when it refuses to run
- Checkpoints saved by 1.3.0 hold the whole database and are refused for in-place restore on PostgreSQL, with an explanation; new checkpoints are not affected
- `lockDatabase(config).reset()` no longer drops platform schemas such as Supabase's `auth`, even when the connecting role is a member of their owner, and accepts a list of schemas to empty

### Fixed
- Restoring a checkpoint on Supabase, or any database where another role owns a schema, no longer fails with `must be owner of schema auth`, and never removes or replaces `auth`, `storage`, `extensions` or other platform schemas, even when your database user is a member of the role that owns them
- Checkpoints now hold only the schemas a restore may replace, plus the extensions installed in them, so a restore no longer reports failure after putting your data back
- Restoring a checkpoint keeps table grants and default privileges, so roles such as Supabase's `anon` keep their access
- A restore can now bring back a schema the bad change dropped

## [1.3.0] - 2026-11-04

### Security
- Encrypted backups that are truncated or missing their authentication tag now fail to decrypt instead of restoring partial data
- Backup and restore refuse to run when encryption is enabled without a key, instead of writing or reading unencrypted data; `DBDOCK_ENCRYPTION_SECRET` and `encryption.secret` now map to the backup key
- Error messages no longer print the encryption key
- MySQL restore runs with `--binary-mode`, `sqlcmd` restore with `-X`, and MySQL database names starting with `-` are rejected
- Cloud API path segments are URL-encoded
- Local backup folders are created with `0700` and the `migrate-config` backup file with `0600`, and that backup file is added to `.gitignore`

### Added
- `dbdock run` saves a checkpoint, runs a change against a local database and keeps a change record
- `dbdock restore <checkpoint-id>` restores a saved checkpoint; `dbdock restore` with no id still opens the backup picker
- `dbdock link` links a directory to a DBDock Cloud project without sharing database credentials
- `dbdock sync` now sends pending change records to Cloud
- SDK exports `runGuardedChange`, `restoreCheckpoint`, `sqlSummary` and `syncRecords`
- `lockDatabase` holds a Postgres or MySQL restore target and resets it before a restore
- `strict`, `beforeRestore` and `checksum` options on `restoreBackupStandalone`; the backup is fully decoded and checked before the target is touched
- `DATABASE_URL` accepts `mysql://` and `mariadb://` URLs and an `sslmode` parameter

### Changed
- `sslMode` is passed to Postgres and MySQL client tools
- Harmless `pg_restore` errors (unknown settings from a newer `pg_dump`, objects that already exist, ownership steps) no longer fail a strict restore

## [1.2.0] - 2026-06-20

### Security
- Storage deletion guard: every object delete now passes structural validation (no empty, traversal, wildcard, leading-slash, or folder-style keys) plus an allow-list of protected prefixes (`backups/`, `wal/`, `dbdock_backups/`, `backup-`), so retention and cleanup can never delete an object outside DBDock's own namespace
- Deletion circuit breaker: a runaway loop cannot delete more than `maxDeletesPerWindow` objects within a rolling window (default 1000/60s)
- Recycle bin: deletes are soft by default — objects are moved to a `.trash/<timestamp>/` prefix (server-side copy on S3/R2) and hard-purged only after `trashRetentionDays` (default 14), recoverable via `StorageService.restoreFromTrash`
- Audit trail: every delete emits a `[storage-audit]` log line with key, reason, and soft/hard outcome
- Guard applies to all providers, the managed bucket, and users' own buckets; tunable via `storage.deletionSafety`

### Added
- Open-source release preparation: `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`
- GitHub Actions CI workflow (lint, build, test)
- Issue and PR templates
- `--driver` flag on `copydb` to use the direct PostgreSQL driver instead of `pg_dump` (works with serverless/modified Postgres)

### Changed
- Repository moved to `github.com/dbdock/dbdock`
- `.gitignore` now excludes `.claude/`, `.cursor/`, `.aider*`, `.vscode/`

### Removed
- Stale `src/cli/commands/backup.ts.bak`
- Local docs folder (canonical docs live at https://docs.dbdock.xyz)

## [1.1.26] - 2026-04

### Added
- Cross-database migration (MongoDB ↔ PostgreSQL) via `dbdock migrate`
- `dbdock analyze` to inspect database structure
- `dbdock copydb` for direct PostgreSQL-to-PostgreSQL copies

### Changed
- Replaced `uuid` with `nanoid` for backup ID generation
- SMTP configuration uses optional chaining to handle missing credentials gracefully
- `.env.example` and config loading now support full database URLs (`DBDOCK_DB_URL` / `DATABASE_URL`)

## [1.1.15]

### Added
- `copydb` command for simplified database copying
- Clearer backup and restore instructions in README

## [1.1.11]

### Added
- Custom webhook support in `.env.example`

### Changed
- Improved environment variable handling

## [1.1.4]

### Added
- Credential masking in logs
- Migration tool and security best practices in README

## [1.0.0]

### Added
- Initial stable release
- PostgreSQL backup and restore
- Multi-cloud storage: local, S3, R2, Cloudinary
- AES-256-GCM encryption with PBKDF2 key derivation
- Compression (zstd)
- Point-in-time recovery via WAL archiving
- Email and Slack alerts
- Cron-based scheduling
- Retention policies

[Unreleased]: https://github.com/dbdock/dbdock/compare/v1.1.26...HEAD
[1.1.26]: https://github.com/dbdock/dbdock/releases/tag/v1.1.26
[1.1.15]: https://github.com/dbdock/dbdock/releases/tag/v1.1.15
[1.1.11]: https://github.com/dbdock/dbdock/releases/tag/v1.1.11
[1.1.4]: https://github.com/dbdock/dbdock/releases/tag/v1.1.4
[1.0.0]: https://github.com/dbdock/dbdock/releases/tag/v1.0.0
