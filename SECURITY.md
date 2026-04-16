# Security Policy

DBDock handles backups, encryption keys, and database credentials. We take security issues seriously.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report privately via one of these channels:

- Email: **naheemolaide@gmail.com**
- GitHub private vulnerability report: https://github.com/dbdock/dbdock/security/advisories/new

Include:

- A description of the issue and its impact
- Steps to reproduce (or a proof of concept)
- The DBDock version affected (`dbdock --version`)
- Your Node.js version and OS

We will acknowledge receipt within 72 hours and aim to provide a status update within 7 days.

## Supported versions

Only the latest minor release line receives security fixes. Older versions should upgrade.

| Version | Supported |
|---|---|
| 1.1.x   | ✅ |
| 1.0.x   | ❌ |
| < 1.0   | ❌ |

## Secure usage guidelines

DBDock is a backup/migration tool — the guidelines below help you use it safely.

### Credentials

- Prefer environment variables (`DBDOCK_DB_PASSWORD`, `DBDOCK_STORAGE_SECRET_KEY`, etc.) over values in `dbdock.config.json`.
- Set `DBDOCK_STRICT_MODE=true` to forbid secrets in config files.
- Use `.env.local` (not `.env`) for secrets and never commit it — see [.env.example](.env.example).

### Encryption

- When enabled, DBDock uses AES-256-GCM with a key derived via PBKDF2.
- Generate a strong secret: `openssl rand -hex 32`
- Store the encryption secret **outside** any backup destination — losing it means losing the ability to decrypt.

### Storage

- S3 / R2 buckets holding backups should be private with server-side encryption enabled.
- Use least-privilege IAM credentials (list/put/get on the specific bucket only).

### Responsible disclosure

We follow coordinated disclosure. Please give us a reasonable window (typically 90 days, shorter for low-severity issues) to release a fix before public disclosure.

Thank you for helping keep DBDock users safe.
