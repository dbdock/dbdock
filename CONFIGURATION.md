# DBDock Configuration Guide

## Overview

DBDock supports three configuration methods:

1. **JSON Config** (Recommended) - `dbdock.config.json`
2. **Environment Variables** - `.env` or system environment
3. **Custom Config Path** - `DBDOCK_CONFIG_PATH` env variable

## Configuration Priority

```
1. JSON Config (if exists) → dbdock.config.json
2. Custom Path (if set) → DBDOCK_CONFIG_PATH=/path/to/config.json
3. Environment Variables → .env or system env
4. Defaults
```

---

## JSON Configuration (Recommended)

### Quick Start

```bash
# Copy the example config
cp node_modules/dbdock/dbdock.config.example.json dbdock.config.json

# Edit with your settings
nano dbdock.config.json
```

### Full Configuration Reference

```json
{
  "postgres": {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "your-password",
    "database": "myapp"
  },
  "storage": {
    "provider": "local",
    "bucket": "dbdock-backups",
    "localPath": "./backups",
    "endpoint": "https://s3.us-west-2.amazonaws.com",
    "accessKeyId": "YOUR-KEY",
    "secretAccessKey": "YOUR-SECRET"
  },
  "encryption": {
    "enabled": true,
    "secret": "your-32-character-secret-key",
    "iterations": 100000
  },
  "schedule": {
    "type": "cron",
    "expression": "0 2 * * *"
  },
  "pitr": {
    "enabled": false,
    "walIntervalSeconds": 300,
    "retentionDays": 30
  },
  "alerts": {
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpUser": "noreply@example.com",
    "smtpPass": "your-smtp-password",
    "to": ["admin@example.com"]
  }
}
```

### Why JSON Config?

✅ **Single Source of Truth** - All settings in one file
✅ **Version Control Friendly** - Commit to git (exclude secrets)
✅ **IDE Support** - Autocomplete and validation
✅ **Easy Sharing** - Copy config between environments
✅ **Type Safety** - Validated against schema

---

## Environment Variables

### When to Use

- **Docker/Containers** - 12-factor app methodology
- **CI/CD Pipelines** - Inject secrets at runtime
- **Cloud Deployments** - Use platform secret management
- **Quick Testing** - Override without editing files

### Full Reference

```bash
# ====================================
# PostgreSQL Database
# ====================================
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-password
DB_NAME=myapp

# ====================================
# Storage Configuration
# ====================================
STORAGE_PROVIDER=local          # local | s3 | r2
STORAGE_BUCKET=dbdock-backups
STORAGE_LOCAL_PATH=./backups

# S3/R2 Credentials (if using cloud storage)
STORAGE_ENDPOINT=https://s3.us-west-2.amazonaws.com
STORAGE_ACCESS_KEY=YOUR-ACCESS-KEY
STORAGE_SECRET_KEY=YOUR-SECRET-KEY

# ====================================
# Encryption
# ====================================
ENCRYPTION_ENABLED=true
ENCRYPTION_SECRET=your-32-character-secret-key
ENCRYPTION_ITERATIONS=100000

# ====================================
# Point-in-Time Recovery (PITR)
# ====================================
PITR_ENABLED=false
PITR_WAL_INTERVAL=300           # seconds
PITR_RETENTION_DAYS=30

# ====================================
# DBDock Configuration
# ====================================
DBDOCK_CONFIG_PATH=./dbdock.config.json
```

### Docker Example

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install DBDock
RUN npm install dbdock

# Copy your app
COPY . .

# Environment variables
ENV DB_HOST=postgres \
    DB_PORT=5432 \
    DB_USER=postgres \
    DB_PASSWORD=your-password \
    DB_NAME=myapp \
    STORAGE_PROVIDER=s3 \
    STORAGE_BUCKET=prod-backups \
    STORAGE_ACCESS_KEY=${AWS_ACCESS_KEY_ID} \
    STORAGE_SECRET_KEY=${AWS_SECRET_ACCESS_KEY} \
    ENCRYPTION_ENABLED=true \
    ENCRYPTION_SECRET=${ENCRYPTION_SECRET}

CMD ["node", "backup.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  dbdock:
    image: node:18-alpine
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: postgres
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: myapp
      STORAGE_PROVIDER: local
      STORAGE_LOCAL_PATH: /backups
      ENCRYPTION_ENABLED: true
      ENCRYPTION_SECRET: ${ENCRYPTION_SECRET}
    volumes:
      - ./backups:/backups
      - ./app:/app
    working_dir: /app
    command: node backup.js

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: myapp
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

---

## Configuration Options

### PostgreSQL

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `host` | string | Yes | localhost | PostgreSQL host |
| `port` | number | Yes | 5432 | PostgreSQL port |
| `user` | string | Yes | postgres | Database user |
| `password` | string | Yes | - | Database password |
| `database` | string | Yes | - | Database name |

### Storage

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `provider` | enum | Yes | - | `local`, `s3`, or `r2` |
| `bucket` | string | Yes | - | Bucket/folder name |
| `localPath` | string | Conditional | ./backups | Path for local storage |
| `endpoint` | string | Conditional | - | S3/R2 endpoint URL |
| `accessKeyId` | string | Conditional | - | S3/R2 access key |
| `secretAccessKey` | string | Conditional | - | S3/R2 secret key |

**Conditional Requirements:**
- `localPath` required when `provider=local`
- `endpoint`, `accessKeyId`, `secretAccessKey` required when `provider=s3` or `r2`

### Encryption

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `enabled` | boolean | Yes | true | Enable encryption |
| `secret` | string | Conditional | - | Encryption key (32+ chars) |
| `iterations` | number | No | 100000 | PBKDF2 iterations |

### Schedule (Optional)

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `type` | enum | Yes | - | `cron` or `interval` |
| `expression` | string | Yes | - | Cron expression or interval |

**Examples:**
```json
{ "type": "cron", "expression": "0 2 * * *" }       // Daily at 2 AM
{ "type": "cron", "expression": "0 */6 * * *" }     // Every 6 hours
{ "type": "interval", "expression": "3600000" }     // Every hour (ms)
```

### PITR (Point-in-Time Recovery)

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `enabled` | boolean | Yes | false | Enable PITR |
| `walIntervalSeconds` | number | No | 300 | WAL check interval |
| `retentionDays` | number | Yes | 30 | Retention period |

### Alerts (Optional)

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `smtpHost` | string | Yes | - | SMTP server host |
| `smtpPort` | number | Yes | - | SMTP server port |
| `smtpUser` | string | Yes | - | SMTP username |
| `smtpPass` | string | Yes | - | SMTP password |
| `to` | array | Yes | - | Email recipients |

---

## Best Practices

### 1. Separate Secrets from Config

❌ **Don't:**
```json
{
  "postgres": {
    "password": "hardcoded-password"
  }
}
```

✅ **Do:**
```json
{
  "postgres": {
    "password": "${DB_PASSWORD}"
  }
}
```

Then use environment variable substitution or separate secrets.

### 2. Use Different Configs per Environment

```
project/
  ├── dbdock.config.json          # Development (git ignored)
  ├── dbdock.config.example.json  # Template (committed)
  ├── config/
  │   ├── development.json
  │   ├── staging.json
  │   └── production.json         # git ignored
```

```bash
# Set config path per environment
DBDOCK_CONFIG_PATH=config/staging.json npm start
```

### 3. Validate Before Deploying

DBDock validates config on startup and throws descriptive errors:

```typescript
// This will fail validation:
{
  "postgres": {
    "port": "not-a-number"  // ❌ Must be number
  }
}

// Error: Configuration validation failed: port must be a number
```

### 4. Secret Management

**Development:**
```bash
# .env (git ignored)
ENCRYPTION_SECRET=dev-secret-key-32-chars-long
```

**Production:**
```bash
# AWS Secrets Manager
ENCRYPTION_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id dbdock/encryption-key \
  --query SecretString \
  --output text)

# HashiCorp Vault
ENCRYPTION_SECRET=$(vault kv get -field=secret dbdock/encryption)

# Kubernetes Secrets
kubectl create secret generic dbdock-secrets \
  --from-literal=encryption-key=your-secret-key
```

---

## Examples

### Local Development

```json
{
  "postgres": {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "dev-password",
    "database": "myapp_dev"
  },
  "storage": {
    "provider": "local",
    "bucket": "dev-backups",
    "localPath": "./backups"
  },
  "encryption": {
    "enabled": true,
    "secret": "dev-secret-key-32-characters-long",
    "iterations": 100000
  },
  "pitr": {
    "enabled": false,
    "retentionDays": 7
  }
}
```

### Production (AWS S3)

```json
{
  "postgres": {
    "host": "prod-db.example.com",
    "port": 5432,
    "user": "dbdock_user",
    "password": "${DB_PASSWORD}",
    "database": "production"
  },
  "storage": {
    "provider": "s3",
    "bucket": "prod-db-backups",
    "endpoint": "https://s3.us-east-1.amazonaws.com",
    "accessKeyId": "${AWS_ACCESS_KEY_ID}",
    "secretAccessKey": "${AWS_SECRET_ACCESS_KEY}"
  },
  "encryption": {
    "enabled": true,
    "secret": "${ENCRYPTION_SECRET}",
    "iterations": 100000
  },
  "schedule": {
    "type": "cron",
    "expression": "0 2 * * *"
  },
  "pitr": {
    "enabled": true,
    "walIntervalSeconds": 300,
    "retentionDays": 90
  },
  "alerts": {
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpUser": "backups@example.com",
    "smtpPass": "${SMTP_PASSWORD}",
    "to": ["ops@example.com", "admin@example.com"]
  }
}
```

### Production (Cloudflare R2)

```json
{
  "postgres": {
    "host": "prod-db.example.com",
    "port": 5432,
    "user": "dbdock_user",
    "password": "${DB_PASSWORD}",
    "database": "production"
  },
  "storage": {
    "provider": "r2",
    "bucket": "prod-db-backups",
    "endpoint": "abc123.r2.cloudflarestorage.com",
    "accessKeyId": "${R2_ACCESS_KEY}",
    "secretAccessKey": "${R2_SECRET_KEY}"
  },
  "encryption": {
    "enabled": true,
    "secret": "${ENCRYPTION_SECRET}",
    "iterations": 100000
  },
  "pitr": {
    "enabled": true,
    "retentionDays": 90
  }
}
```

---

## Troubleshooting

### Config Not Found

```
Error: Configuration file not found: dbdock.config.json
```

**Solution:** Create config file or set environment variables

```bash
cp node_modules/dbdock/dbdock.config.example.json dbdock.config.json
```

### Validation Errors

```
Error: Configuration validation failed: port must be a number
```

**Solution:** Check data types match the schema

### Missing Secrets

```
Error: Encryption is enabled but no secret provided
```

**Solution:** Set encryption secret in config or environment

---

## Migration Guide

### From Environment Variables to JSON

```bash
# 1. Create config from current env
cat > dbdock.config.json << EOF
{
  "postgres": {
    "host": "$DB_HOST",
    "port": $DB_PORT,
    "user": "$DB_USER",
    "password": "$DB_PASSWORD",
    "database": "$DB_NAME"
  },
  "storage": {
    "provider": "$STORAGE_PROVIDER",
    "bucket": "$STORAGE_BUCKET"
  }
}
EOF

# 2. Test it works
node backup.js

# 3. Remove env vars
unset DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
```

### From JSON to Environment Variables

```bash
# 1. Export from JSON
export DB_HOST=$(jq -r '.postgres.host' dbdock.config.json)
export DB_PORT=$(jq -r '.postgres.port' dbdock.config.json)
# ... etc

# 2. Remove JSON file
rm dbdock.config.json

# 3. Test it works
node backup.js
```

---

## Summary

| Method | Best For | Pros | Cons |
|--------|----------|------|------|
| **JSON Config** | Development, Teams | Easy to share, version control | Secrets in file |
| **Environment Vars** | Production, Docker | Secure secrets, 12-factor | Many variables |
| **Custom Path** | Multi-environment | Flexibility | Requires path management |

**Recommendation:** Use JSON for development, environment variables for production.
