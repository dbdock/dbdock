# DBDock Email Alerts

DBDock can send email notifications for backup events using SMTP.

## Quick Start

### 1. Configure Alerts

Add the `alerts` section to your `dbdock.config.json`:

```json
{
  "alerts": {
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpUser": "backups@example.com",
    "smtpPass": "your-app-password",
    "to": ["admin@example.com", "ops@example.com"]
  }
}
```

### 2. SMTP Providers

#### Gmail
```json
{
  "smtpHost": "smtp.gmail.com",
  "smtpPort": 587,
  "smtpUser": "your-email@gmail.com",
  "smtpPass": "your-app-password"
}
```

**Note:** Use an [App Password](https://support.google.com/accounts/answer/185833), not your regular password.

#### SendGrid
```json
{
  "smtpHost": "smtp.sendgrid.net",
  "smtpPort": 587,
  "smtpUser": "apikey",
  "smtpPass": "your-sendgrid-api-key"
}
```

#### AWS SES
```json
{
  "smtpHost": "email-smtp.us-east-1.amazonaws.com",
  "smtpPort": 587,
  "smtpUser": "your-smtp-username",
  "smtpPass": "your-smtp-password"
}
```

#### ZeptoMail
```json
{
  "smtpHost": "smtp.zeptomail.com",
  "smtpPort": 465,
  "smtpUser": "emailapikey",
  "smtpPass": "your-api-key"
}
```

## Alert Types

DBDock sends alerts for these events:

- **Backup Success** - When a backup completes successfully
- **Backup Failure** - When a backup fails
- **Retention Cleanup** - After old backups are deleted
- **Storage Error** - When storage access fails

## Custom Email Templates

You can customize email templates for each alert type.

### Using Custom Templates

```typescript
import { createDBDock, AlertService, AlertType } from 'dbdock';

async function setupCustomTemplates() {
  const app = await createDBDock();
  const alertService = app.get(AlertService);

  // Set custom template for backup success
  alertService.setCustomTemplate(AlertType.BACKUP_SUCCESS, {
    subject: '✅ Backup Complete - {{database}}',
    body: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #22c55e;">Backup Successful!</h2>

        <p>Your database <strong>{{database}}</strong> has been backed up.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f3f4f6;">
            <td style="padding: 10px; border: 1px solid #e5e7eb;">Backup ID</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">{{backupId}}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">Size</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">{{size}} MB</td>
          </tr>
          <tr style="background: #f3f4f6;">
            <td style="padding: 10px; border: 1px solid #e5e7eb;">Duration</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">{{duration}} seconds</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">Timestamp</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">{{timestamp}}</td>
          </tr>
        </table>

        {{#if downloadUrl}}
        <a href="{{downloadUrl}}"
           style="display: inline-block; padding: 12px 24px; background: #3b82f6;
                  color: white; text-decoration: none; border-radius: 6px; margin: 10px 0;">
          Download Backup
        </a>
        <p style="color: #6b7280; font-size: 14px;">Link expires in 7 days</p>
        {{/if}}
      </div>
    `,
  });

  // Set custom template for backup failure
  alertService.setCustomTemplate(AlertType.BACKUP_FAILURE, {
    subject: '🚨 URGENT: Backup Failed - {{database}}',
    body: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #ef4444;">Backup Failed!</h2>

        <p style="background: #fee2e2; padding: 15px; border-left: 4px solid #ef4444;">
          <strong>Action Required:</strong> The backup for <strong>{{database}}</strong> has failed.
        </p>

        <h3>Error Details:</h3>
        <pre style="background: #f3f4f6; padding: 15px; border-radius: 6px; overflow-x: auto;">{{error}}</pre>

        <p style="color: #6b7280; margin-top: 20px;">Backup ID: {{backupId}}</p>
        <p style="color: #6b7280;">Timestamp: {{timestamp}}</p>
      </div>
    `,
  });

  await app.close();
}

setupCustomTemplates();
```

## Template Variables

### Backup Success
- `{{database}}` - Database name
- `{{backupId}}` - Unique backup ID
- `{{size}}` - Backup size in MB
- `{{compressedSize}}` - Compressed size in MB
- `{{duration}}` - Duration in seconds
- `{{timestamp}}` - Completion timestamp
- `{{downloadUrl}}` - Download URL (optional)

### Backup Failure
- `{{database}}` - Database name
- `{{backupId}}` - Unique backup ID
- `{{timestamp}}` - Failure timestamp
- `{{error}}` - Error message

### Retention Cleanup
- `{{backupsDeleted}}` - Number of backups deleted
- `{{walFilesDeleted}}` - Number of WAL files deleted
- `{{spaceFreed}}` - Space freed in MB
- `{{timestamp}}` - Cleanup timestamp

### Storage Error
- `{{error}}` - Error message
- `{{timestamp}}` - Error timestamp

## Template Syntax

### Variables
```html
<p>Database: {{database}}</p>
<p>Size: {{size}} MB</p>
```

### Conditional Sections
```html
{{#if downloadUrl}}
  <a href="{{downloadUrl}}">Download Backup</a>
{{/if}}
```

## Verify SMTP Connection

Test your SMTP configuration:

```typescript
import { createDBDock, AlertService } from 'dbdock';

async function verifySmtp() {
  const app = await createDBDock();
  const alertService = app.get(AlertService);

  const isConnected = await alertService.verifyConnection();

  if (isConnected) {
    console.log('✅ SMTP connection successful');
  } else {
    console.log('❌ SMTP connection failed');
  }

  await app.close();
}

verifySmtp();
```

## Manual Alert Testing

Send a test alert:

```typescript
import { createDBDock, AlertService, AlertType } from 'dbdock';

async function sendTestAlert() {
  const app = await createDBDock();
  const alertService = app.get(AlertService);

  // Send test success alert
  await alertService.sendBackupSuccessAlert(
    {
      id: 'test-backup-id',
      database: 'test-db',
      type: 'full',
      status: 'completed',
      startTime: new Date(),
      endTime: new Date(),
      duration: 5000,
      size: 1024 * 1024 * 100,
      compressedSize: 1024 * 1024 * 30,
      storageKey: 'test-key',
      compression: { enabled: true, algorithm: 'brotli' },
    },
    'https://example.com/download',
  );

  console.log('✅ Test alert sent!');

  await app.close();
}

sendTestAlert();
```

## Best Practices

1. **Use App Passwords**: Don't use your main email password, use app-specific passwords
2. **Test SMTP Config**: Always verify connection before deploying
3. **Monitor Delivery**: Check spam folders initially
4. **Customize Templates**: Make templates match your organization's branding
5. **Multiple Recipients**: Add multiple email addresses for critical alerts
6. **Secure Credentials**: Store SMTP passwords in environment variables or secrets manager

## Troubleshooting

### Emails not being sent

1. Verify SMTP configuration:
   ```typescript
   const isConnected = await alertService.verifyConnection();
   ```

2. Check logs for errors:
   ```bash
   # Look for "Alert sent" or "Failed to send alert" messages
   ```

3. Verify port settings:
   - Port 465: Use SSL
   - Port 587: Use TLS
   - Port 25: Plain SMTP (not recommended)

### Emails going to spam

- Add SPF and DKIM records to your domain
- Use a reputable SMTP provider
- Avoid spam trigger words in templates
- Ensure "from" address matches SMTP user

### SSL/TLS errors

- For port 465: Use `"smtpPort": 465` (SSL)
- For port 587: Use `"smtpPort": 587` (TLS)
- Check firewall settings

## Environment Variables

You can also configure alerts via environment variables:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=backups@example.com
SMTP_PASS=your-app-password
SMTP_TO=admin@example.com,ops@example.com
```

Then in your config service, load them as needed.
