# CLI Reference

Complete command-line interface reference for DBDock.

## Installation

DBDock can be used without installation via `npx`, or installed globally:

```bash
npm install -g dbdock
```

Or use directly:

```bash
npx dbdock [command]
```

## Commands

### `dbdock init`

Initialize a new DBDock configuration file with an interactive setup wizard.

```bash
npx dbdock init
```

This command will:
- Prompt you to select your database type (PostgreSQL, MySQL, MongoDB, SQLite)
- Ask for database connection details
- Configure your preferred storage provider (Local, S3, Cloudinary)
- Set up encryption and compression options
- Generate a `dbdock.config.json` file in your current directory

**Options:**

The `init` command is fully interactive and has no command-line options.

**Example:**

```bash
$ npx dbdock init
? Select database type: postgres
? Database host: localhost
? Database port: 5432
? Database username: postgres
? Database password: ********
? Database name: myapp
? Select storage provider: s3
? S3 bucket name: my-backups
? S3 region: us-east-1
? S3 access key ID: AKIA...
? S3 secret access key: ********
? Enable encryption? Yes
? Encryption key (32 characters): ********************************
? Enable compression? Yes
? Compression level: 6

✓ Configuration saved to dbdock.config.json

Next steps:
  - Run "npx dbdock test" to verify your configuration
  - Run "npx dbdock backup" to create your first backup
```

---

### `dbdock backup`

Create an immediate backup of your database.

```bash
npx dbdock backup
```

This command will:
- Load configuration from `dbdock.config.json`
- Connect to your database
- Create a backup with compression and encryption (if enabled)
- Upload to your configured storage provider
- Display backup details (ID, size, duration)

**Environment Variables:**

You can override configuration values:

```bash
export DBDOCK_DB_PASSWORD=production-password
export DBDOCK_S3_BUCKET=prod-backups
npx dbdock backup
```

**Example:**

```bash
$ npx dbdock backup
✓ Loading configuration...
✓ Starting backup...
✓ Backup completed successfully

✓ Backup ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
ℹ Storage key: backups/backup-2024-01-15T10-30-00-000Z-a1b2c3d4.sql
ℹ Size: 45.32 MB
ℹ Duration: 12543ms
```

---

### `dbdock restore`

Restore your database from a backup with interactive selection.

```bash
npx dbdock restore
```

This command will:
- Load configuration from `dbdock.config.json`
- List all available backups
- Allow you to select a backup to restore
- Ask for confirmation before proceeding
- Restore the selected backup to your database

**WARNING:** This will overwrite your current database. Always backup before restoring.

**Example:**

```bash
$ npx dbdock restore
? Select backup to restore:
  backup-2024-01-15T10-30-00-000Z-a1b2c3d4.sql (45.32 MB) - 1/15/2024, 10:30:00 AM
> backup-2024-01-14T10-30-00-000Z-b2c3d4e5.sql (42.18 MB) - 1/14/2024, 10:30:00 AM
  backup-2024-01-13T10-30-00-000Z-c3d4e5f6.sql (41.95 MB) - 1/13/2024, 10:30:00 AM

? This will overwrite the current database. Continue? Yes
✓ Restoring backup...
✓ Restore completed successfully
```

**Note:** Currently only supports local storage provider. S3 and Cloudinary support coming soon.

---

### `dbdock test`

Test your database connection and storage configuration.

```bash
npx dbdock test
```

This command will:
- Load configuration from `dbdock.config.json`
- Test database connectivity
- Validate storage provider configuration
- Report any issues found

Use this command to troubleshoot connection problems before running backups.

**Example:**

```bash
$ npx dbdock test
ℹ Testing DBDock configuration...

✓ Configuration loaded
✓ Testing database connection...
✓ Database connection successful
✓ Testing storage configuration...
✓ Storage configuration valid

✓ All tests passed! Your configuration is ready to use.
```

**Error Example:**

```bash
$ npx dbdock test
ℹ Testing DBDock configuration...

✓ Configuration loaded
✓ Testing database connection...
✗ Test failed
✗ Database connection failed: password authentication failed for user "postgres"
```

---

### `dbdock schedule`

Manage backup schedules with an interactive menu.

```bash
npx dbdock schedule
```

This command allows you to:
- View current backup schedules
- Add new schedules with cron expressions
- Remove existing schedules
- Enable/disable schedules

**Example:**

```bash
$ npx dbdock schedule
? What would you like to do?
> View current schedules
  Add new schedule
  Remove schedule

ℹ Current schedules:

1. Daily Backup
   Cron: 0 2 * * *
   Enabled: Yes

2. Weekly Backup
   Cron: 0 0 * * 0
   Enabled: Yes
```

**Adding a Schedule:**

```bash
$ npx dbdock schedule
? What would you like to do? Add new schedule
? Schedule name: Hourly Backup
? Select schedule preset:
  Every hour
> Every day at midnight
  Every day at 2 AM
  Every week (Sunday at midnight)
  Every month (1st at midnight)
  Custom cron expression

? Enable this schedule immediately? Yes

✓ Schedule added successfully
ℹ Note: Schedules require the DBDock service to be running
```

**Custom Cron Expression:**

```bash
? Select schedule preset: Custom cron expression
? Enter cron expression (e.g., "0 2 * * *"): 0 */6 * * *
```

Cron expression format:
```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, Sunday = 0 or 7)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

---

## Global Options

All commands support these environment variables:

### Configuration Path

Use a custom config file location:

```bash
export DBDOCK_CONFIG_PATH=/path/to/custom-config.json
npx dbdock backup
```

### Database Overrides

```bash
export DBDOCK_DB_HOST=production-db.example.com
export DBDOCK_DB_PORT=5432
export DBDOCK_DB_USERNAME=postgres
export DBDOCK_DB_PASSWORD=secret
export DBDOCK_DB_DATABASE=myapp
```

### Storage Overrides

For local storage:
```bash
export DBDOCK_STORAGE_PROVIDER=local
export DBDOCK_STORAGE_LOCAL_PATH=/var/backups
```

For S3:
```bash
export DBDOCK_STORAGE_PROVIDER=s3
export DBDOCK_S3_BUCKET=my-backups
export DBDOCK_S3_REGION=us-east-1
export DBDOCK_S3_ACCESS_KEY_ID=AKIA...
export DBDOCK_S3_SECRET_ACCESS_KEY=secret
```

For Cloudinary:
```bash
export DBDOCK_STORAGE_PROVIDER=cloudinary
export DBDOCK_CLOUDINARY_CLOUD_NAME=mycloud
export DBDOCK_CLOUDINARY_API_KEY=123456
export DBDOCK_CLOUDINARY_API_SECRET=secret
```

---

## Exit Codes

All commands use standard exit codes:

- `0` - Success
- `1` - Error occurred

Use these for scripting:

```bash
if npx dbdock backup; then
  echo "Backup successful"
else
  echo "Backup failed"
  exit 1
fi
```

---

## Configuration File

All commands expect a `dbdock.config.json` file in the current directory (unless overridden with `DBDOCK_CONFIG_PATH`).

See [Configuration Guide](../CONFIGURATION.md) for full configuration reference.

---

## Troubleshooting

### Command not found

If you get "command not found" errors:

```bash
npx dbdock@latest init
```

Or install globally:

```bash
npm install -g dbdock
dbdock init
```

### Permission denied

If you get permission errors when running backups:

```bash
chmod +x node_modules/.bin/dbdock
```

Or use npx:

```bash
npx dbdock backup
```

### Configuration not found

Ensure you're in the directory containing `dbdock.config.json`, or set:

```bash
export DBDOCK_CONFIG_PATH=/path/to/dbdock.config.json
```

---

## Examples

### Daily Production Backup

```bash
export DBDOCK_CONFIG_PATH=/etc/dbdock/production.json
export DBDOCK_DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id db-password --query SecretString --output text)

npx dbdock backup
```

### Restore from Specific Backup

```bash
npx dbdock restore
```

Then select the backup from the interactive list.

### Test Before Deploying

```bash
npx dbdock test && npx dbdock backup || echo "Configuration error"
```

---

## Next Steps

- [Quick Start Guide](./quick-start.md)
- [Configuration Guide](../CONFIGURATION.md)
- [Programmatic Usage](./programmatic-usage.md)
