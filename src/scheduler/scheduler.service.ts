import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DBDockConfigService } from '../config/config.service';
import { BackupService } from '../backup/backup.service';
import { RetentionService } from '../wal/retention.service';
import { readFileSync } from 'fs';
import { join } from 'path';

interface ScheduleConfig {
  name: string;
  cron: string;
  enabled: boolean;
}

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private scheduledBackupsEnabled = false;
  private retentionCleanupEnabled = true;
  private registeredJobs: Map<string, CronJob> = new Map();

  constructor(
    private configService: DBDockConfigService,
    private backupService: BackupService,
    private retentionService: RetentionService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    this.loadAndRegisterSchedules();

    if (this.retentionCleanupEnabled) {
      this.logger.log('Retention cleanup scheduler enabled');
    }
  }

  private loadAndRegisterSchedules() {
    try {
      const configPath = join(process.cwd(), 'dbdock.config.json');
      const configFile = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        backup?: { schedules?: ScheduleConfig[] };
      };
      const schedules: ScheduleConfig[] = configFile.backup?.schedules || [];

      if (schedules.length === 0) {
        this.logger.log('No backup schedules configured');
        return;
      }

      const enabledSchedules = schedules.filter((s) => s.enabled !== false);

      if (enabledSchedules.length === 0) {
        this.logger.log('All backup schedules are disabled');
        return;
      }

      enabledSchedules.forEach((schedule) => {
        this.registerSchedule(schedule);
      });

      this.logger.log(
        `Registered ${enabledSchedules.length} backup schedule(s)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load schedules: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private registerSchedule(schedule: ScheduleConfig) {
    try {
      const job = CronJob.from({
        cronTime: schedule.cron,
        onTick: () => {
          void this.executeScheduledBackup(schedule.name);
        },
      });

      this.schedulerRegistry.addCronJob(schedule.name, job);
      job.start();

      this.registeredJobs.set(schedule.name, job);
      this.logger.log(
        `Registered schedule: ${schedule.name} (${schedule.cron})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to register schedule "${schedule.name}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async executeScheduledBackup(scheduleName: string): Promise<void> {
    this.logger.log(`Executing scheduled backup: ${scheduleName}`);

    try {
      const result = await this.backupService.createBackup({
        compress: true,
        encrypt: true,
      });

      this.logger.log(
        `Scheduled backup "${scheduleName}" completed: ${result.metadata.id} (${result.metadata.size} bytes)`,
      );
    } catch (error) {
      this.logger.error(
        `Scheduled backup "${scheduleName}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  reloadSchedules(): void {
    this.registeredJobs.forEach((job, name) => {
      void job.stop();
      this.schedulerRegistry.deleteCronJob(name);
    });

    this.registeredJobs.clear();

    this.loadAndRegisterSchedules();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailyRetentionCleanup() {
    if (!this.retentionCleanupEnabled) {
      return;
    }

    this.logger.log('Running scheduled retention cleanup');

    try {
      const result = await this.retentionService.applyRetentionPolicy();

      this.logger.log(
        `Retention cleanup completed: ${result.backupsDeleted} backups, ${result.walFilesDeleted} WAL files deleted`,
      );

      if (result.errors.length > 0) {
        this.logger.warn(
          `Retention cleanup had ${result.errors.length} errors`,
        );
        result.errors.forEach((error) => this.logger.error(error));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Retention cleanup failed: ${msg}`);
    }
  }

  async triggerScheduledBackup(): Promise<void> {
    const scheduleConfig = this.configService.get('schedule');

    if (!scheduleConfig) {
      throw new Error('Scheduled backups are not configured');
    }

    this.logger.log('Running scheduled backup');

    try {
      const result = await this.backupService.createBackup({
        compress: true,
        encrypt: true,
      });

      this.logger.log(
        `Scheduled backup completed: ${result.metadata.id} (${result.metadata.size} bytes)`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scheduled backup failed: ${msg}`);
      throw error;
    }
  }

  async manualRetentionCleanup(): Promise<void> {
    this.logger.log('Running manual retention cleanup');
    await this.handleDailyRetentionCleanup();
  }

  enableScheduledBackups(): void {
    this.scheduledBackupsEnabled = true;
    this.logger.log('Scheduled backups enabled');
  }

  disableScheduledBackups(): void {
    this.scheduledBackupsEnabled = false;
    this.logger.log('Scheduled backups disabled');
  }

  enableRetentionCleanup(): void {
    this.retentionCleanupEnabled = true;
    this.logger.log('Retention cleanup enabled');
  }

  disableRetentionCleanup(): void {
    this.retentionCleanupEnabled = false;
    this.logger.log('Retention cleanup disabled');
  }
}
