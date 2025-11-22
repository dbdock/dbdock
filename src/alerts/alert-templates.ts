import { AlertType, AlertTemplate } from './alert.types';

export const DEFAULT_TEMPLATES: Record<AlertType, AlertTemplate> = {
  [AlertType.BACKUP_SUCCESS]: {
    subject: '✅ DBDock Backup Successful - {{database}}',
    body: `
      <h2>Backup Completed Successfully</h2>
      <p>Your database backup has been completed successfully.</p>

      <h3>Backup Details</h3>
      <ul>
        <li><strong>Database:</strong> {{database}}</li>
        <li><strong>Backup ID:</strong> {{backupId}}</li>
        <li><strong>Size:</strong> {{size}} MB</li>
        <li><strong>Compressed Size:</strong> {{compressedSize}} MB</li>
        <li><strong>Duration:</strong> {{duration}} seconds</li>
        <li><strong>Timestamp:</strong> {{timestamp}}</li>
      </ul>

      {{#if downloadUrl}}
      <h3>Download URL</h3>
      <p><a href="{{downloadUrl}}">Download Backup</a> (valid for 7 days)</p>
      {{/if}}

      <p><em>This is an automated message from DBDock.</em></p>
    `,
  },

  [AlertType.BACKUP_FAILURE]: {
    subject: '❌ DBDock Backup Failed - {{database}}',
    body: `
      <h2>Backup Failed</h2>
      <p>Your database backup has failed.</p>

      <h3>Backup Details</h3>
      <ul>
        <li><strong>Database:</strong> {{database}}</li>
        <li><strong>Backup ID:</strong> {{backupId}}</li>
        <li><strong>Timestamp:</strong> {{timestamp}}</li>
      </ul>

      <h3>Error Details</h3>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px;">{{error}}</pre>

      <p><strong>Action Required:</strong> Please check your database configuration and try again.</p>

      <p><em>This is an automated message from DBDock.</em></p>
    `,
  },

  [AlertType.RETENTION_CLEANUP]: {
    subject: '🗑️ DBDock Retention Cleanup Completed',
    body: `
      <h2>Retention Cleanup Completed</h2>
      <p>Old backups have been cleaned up according to your retention policy.</p>

      <h3>Cleanup Summary</h3>
      <ul>
        <li><strong>Backups Deleted:</strong> {{backupsDeleted}}</li>
        <li><strong>WAL Files Deleted:</strong> {{walFilesDeleted}}</li>
        <li><strong>Space Freed:</strong> {{spaceFreed}} MB</li>
        <li><strong>Timestamp:</strong> {{timestamp}}</li>
      </ul>

      <p><em>This is an automated message from DBDock.</em></p>
    `,
  },

  [AlertType.STORAGE_ERROR]: {
    subject: '⚠️ DBDock Storage Error',
    body: `
      <h2>Storage Error Detected</h2>
      <p>An error occurred while accessing storage.</p>

      <h3>Error Details</h3>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px;">{{error}}</pre>

      <p><strong>Action Required:</strong> Please check your storage configuration and credentials.</p>

      <p><em>This is an automated message from DBDock.</em></p>
    `,
  },
};

export function renderTemplate(template: string, context: Record<string, any>): string {
  let rendered = template;

  for (const [key, value] of Object.entries(context)) {
    const stringValue = value !== undefined && value !== null ? String(value) : '';
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), stringValue);
  }

  rendered = rendered.replace(/{{#if\s+(\w+)}}([\s\S]*?){{\/if}}/g, (match, key, content) => {
    return context[key] ? content : '';
  });

  return rendered;
}
