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
      this.logger.log('Email alerts disabled - no alerts configuration found');
      return;
    }

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

  setCustomTemplate(type: AlertType, template: AlertTemplate): void {
    this.customTemplates[type] = template;
    this.logger.log(`Custom template set for alert type: ${type}`);
  }

  async sendBackupSuccessAlert(
    metadata: BackupMetadata,
    downloadUrl?: string,
  ): Promise<void> {
    if (!this.transporter) return;

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
    if (!this.transporter) return;

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
    if (!this.transporter) return;

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
    if (!this.transporter) return;

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
    if (!this.transporter) return;

    const alertsConfig = this.configService.get('alerts');
    if (!alertsConfig) return;

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
        `Alert sent: ${alertContext.type} to ${alertsConfig.to.join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send alert (${alertContext.type}): ${(error as Error).message}`,
      );
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
