# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Local docs folder (canonical docs live at https://dbdock.mintlify.app)

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
