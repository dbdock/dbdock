import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { DBDockConfigService } from '../config/config.service';
import {
  AlertType,
  AlertContext,
  EmailOptions,
  AlertTemplate,
} from './alert.types';
import { DEFAULT_TEMPLATES, renderTemplate } from './alert-templates';
import { BackupMetadata } from '../backup/backup.types';

import fetch from 'node-fetch';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private transporter: Transporter | null = null;
  private customTemplates: Partial<Record<AlertType, AlertTemplate>> = {};

  constructor(private configService: DBDockConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const alertsConfig = this.configService.get('alerts');

    if (!alertsConfig) {
      this.logger.log('Alerts disabled - no alerts configuration found');
      return;
    }

    if (alertsConfig.smtpHost) {
      try {
        this.transporter = nodemailer.createTransport({
          host: alertsConfig.smtpHost,
          port: alertsConfig.smtpPort,
          secure: alertsConfig.smtpPort === 465,
          auth: {
            user: alertsConfig.smtpUser,
            pass: alertsConfig.smtpPass,
          },
        });

        this.logger.log(
          `Email alerts enabled - configured for ${alertsConfig.smtpHost}:${alertsConfig.smtpPort}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to initialize email transporter: ${(error as Error).message}`,
        );
      }
    }

    if (alertsConfig.slackWebhook) {
      this.logger.log('Slack alerts enabled');
    }
  }

  setCustomTemplate(type: AlertType, template: AlertTemplate): void {
    this.customTemplates[type] = template;
    this.logger.log(`Custom template set for alert type: ${type}`);
  }

  async sendBackupSuccessAlert(
    metadata: BackupMetadata,
    downloadUrl?: string,
  ): Promise<void> {
    const context = {
      database: metadata.database,
      backupId: metadata.id,
      size: ((metadata.size || 0) / 1024 / 1024).toFixed(2),
      compressedSize: ((metadata.compressedSize || 0) / 1024 / 1024).toFixed(2),
      duration: ((metadata.duration || 0) / 1000).toFixed(2),
      timestamp: metadata.endTime?.toLocaleString() || new Date().toLocaleString(),
      downloadUrl,
    };

    await this.sendAlert({
      type: AlertType.BACKUP_SUCCESS,
      metadata,
      downloadUrl,
      details: context,
    });
  }

  async sendBackupFailureAlert(
    metadata: BackupMetadata,
    error: Error,
  ): Promise<void> {
    const context = {
      database: metadata.database,
      backupId: metadata.id,
      timestamp: metadata.endTime?.toLocaleString() || new Date().toLocaleString(),
      error: error.message,
    };

    await this.sendAlert({
      type: AlertType.BACKUP_FAILURE,
      metadata,
      error,
      details: context,
    });
  }

  async sendRetentionCleanupAlert(details: {
    backupsDeleted: number;
    walFilesDeleted: number;
    spaceFreed: number;
  }): Promise<void> {
    const context = {
      backupsDeleted: details.backupsDeleted,
      walFilesDeleted: details.walFilesDeleted,
      spaceFreed: (details.spaceFreed / 1024 / 1024).toFixed(2),
      timestamp: new Date().toLocaleString(),
    };

    await this.sendAlert({
      type: AlertType.RETENTION_CLEANUP,
      details: context,
    });
  }

  async sendStorageErrorAlert(error: Error): Promise<void> {
    const context = {
      error: error.message,
      timestamp: new Date().toLocaleString(),
    };

    await this.sendAlert({
      type: AlertType.STORAGE_ERROR,
      error,
      details: context,
    });
  }

  private async sendAlert(alertContext: AlertContext): Promise<void> {
    const alertsConfig = this.configService.get('alerts');
    if (!alertsConfig) return;

    // Send Email Alert
    if (this.transporter && alertsConfig.to) {
      try {
        const template =
          this.customTemplates[alertContext.type] ||
          DEFAULT_TEMPLATES[alertContext.type];

        const subject = renderTemplate(template.subject, alertContext.details || {});
        const html = renderTemplate(template.body, alertContext.details || {});
        const text = html.replace(/<[^>]*>/g, '');

        await this.sendEmail({
          to: alertsConfig.to,
          subject,
          html,
          text,
        });

        this.logger.log(
          `Email alert sent: ${alertContext.type} to ${alertsConfig.to.join(', ')}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to send email alert (${alertContext.type}): ${(error as Error).message}`,
        );
      }
    }

    // Send Slack Alert
    if (alertsConfig.slackWebhook) {
      try {
        await this.sendSlackAlert(alertsConfig.slackWebhook, alertContext);
        this.logger.log(`Slack alert sent: ${alertContext.type}`);
      } catch (error) {
        this.logger.error(
          `Failed to send Slack alert (${alertContext.type}): ${(error as Error).message}`,
        );
      }
    }
  }

  private async sendSlackAlert(webhookUrl: string, context: AlertContext): Promise<void> {
    let color = '#36a64f'; // Green for success
    let title = 'DBDock Alert';
    let text = '';

    switch (context.type) {
      case AlertType.BACKUP_SUCCESS:
        title = '✅ Backup Successful';
        text = `Database: *${context.details?.database}*\nSize: ${context.details?.size} MB\nDuration: ${context.details?.duration}s`;
        break;
      case AlertType.BACKUP_FAILURE:
        color = '#dc3545'; // Red for failure
        title = '❌ Backup Failed';
        text = `Database: *${context.details?.database}*\nError: ${context.details?.error}`;
        break;
      case AlertType.RETENTION_CLEANUP:
        color = '#17a2b8'; // Blue for info
        title = '🧹 Retention Cleanup';
        text = `Deleted ${context.details?.backupsDeleted} backups\nFreed ${context.details?.spaceFreed} MB`;
        break;
      case AlertType.STORAGE_ERROR:
        color = '#ffc107'; // Yellow for warning
        title = '⚠️ Storage Error';
        text = `Error: ${context.details?.error}`;
        break;
    }

    const payload = {
      attachments: [
        {
          color,
          title,
          text,
          fields: Object.entries(context.details || {})
            .filter(([key]) => !['database', 'size', 'duration', 'error', 'backupsDeleted', 'spaceFreed'].includes(key))
            .map(([key, value]) => ({
              title: key.charAt(0).toUpperCase() + key.slice(1),
              value: String(value),
              short: true,
            })),
          footer: 'DBDock',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.statusText}`);
    }
  }

  private async sendEmail(options: EmailOptions): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not initialized');
    }

    const alertsConfig = this.configService.get('alerts');
    if (!alertsConfig) {
      throw new Error('Alerts configuration not found');
    }

    const fromAddress = alertsConfig.from || alertsConfig.smtpUser;

    await this.transporter.sendMail({
      from: `DBDock <${fromAddress}>`,
      to: options.to.join(', '),
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully');
      return true;
    } catch (error) {
      this.logger.error(
        `SMTP connection verification failed: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
