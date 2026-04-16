import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface Schedule {
  name: string;
  cron: string;
  enabled: boolean;
}

interface ScheduleConfigFile {
  backup?: {
    schedules?: Schedule[];
  };
  [key: string]: unknown;
}

export class ScheduleManager {
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || join(process.cwd(), 'dbdock.config.json');
  }

  private loadConfig(): ScheduleConfigFile {
    if (!existsSync(this.configPath)) {
      throw new Error(
        `Configuration file not found: ${this.configPath}. Run "npx dbdock init" first.`,
      );
    }

    try {
      const content = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(content) as ScheduleConfigFile;
    } catch (error) {
      throw new Error(
        `Failed to parse configuration file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private saveConfig(config: ScheduleConfigFile): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      throw new Error(
        `Failed to save configuration file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getSchedules(): Schedule[] {
    const config = this.loadConfig();
    return config.backup?.schedules || [];
  }

  addSchedule(
    schedule: Omit<Schedule, 'enabled'> & { enabled?: boolean },
  ): void {
    const config = this.loadConfig();

    if (!config.backup) {
      config.backup = {};
    }

    if (!config.backup.schedules) {
      config.backup.schedules = [];
    }

    const existingSchedule = config.backup.schedules.find(
      (s: Schedule) => s.name === schedule.name,
    );

    if (existingSchedule) {
      throw new Error(
        `Schedule with name "${schedule.name}" already exists. Use updateSchedule() to modify it.`,
      );
    }

    this.validateCronExpression(schedule.cron);

    config.backup.schedules.push({
      name: schedule.name,
      cron: schedule.cron,
      enabled: schedule.enabled !== false,
    });

    this.saveConfig(config);
  }

  updateSchedule(name: string, updates: Partial<Omit<Schedule, 'name'>>): void {
    const config = this.loadConfig();
    const schedules = config.backup?.schedules || [];

    const scheduleIndex = schedules.findIndex((s: Schedule) => s.name === name);

    if (scheduleIndex === -1) {
      throw new Error(`Schedule with name "${name}" not found`);
    }

    if (updates.cron) {
      this.validateCronExpression(updates.cron);
    }

    schedules[scheduleIndex] = {
      ...schedules[scheduleIndex],
      ...updates,
    };

    this.saveConfig(config);
  }

  removeSchedule(name: string): void {
    const config = this.loadConfig();
    const schedules = config.backup?.schedules || [];

    const scheduleIndex = schedules.findIndex((s: Schedule) => s.name === name);

    if (scheduleIndex === -1) {
      throw new Error(`Schedule with name "${name}" not found`);
    }

    schedules.splice(scheduleIndex, 1);
    this.saveConfig(config);
  }

  enableSchedule(name: string): void {
    this.updateSchedule(name, { enabled: true });
  }

  disableSchedule(name: string): void {
    this.updateSchedule(name, { enabled: false });
  }

  getSchedule(name: string): Schedule | undefined {
    const schedules = this.getSchedules();
    return schedules.find((s) => s.name === name);
  }

  clearAllSchedules(): void {
    const config = this.loadConfig();

    if (config.backup?.schedules) {
      config.backup.schedules = [];
      this.saveConfig(config);
    }
  }

  private validateCronExpression(cron: string): void {
    const parts = cron.trim().split(/\s+/);

    if (parts.length !== 5) {
      throw new Error(
        'Invalid cron expression. Expected format: "minute hour day month weekday" (5 parts)',
      );
    }

    const validRanges = [
      { name: 'minute', min: 0, max: 59 },
      { name: 'hour', min: 0, max: 23 },
      { name: 'day', min: 1, max: 31 },
      { name: 'month', min: 1, max: 12 },
      { name: 'weekday', min: 0, max: 7 },
    ];

    parts.forEach((part, index) => {
      if (
        part === '*' ||
        part.includes('-') ||
        part.includes(',') ||
        part.includes('/')
      ) {
        return;
      }

      const num = parseInt(part);
      const range = validRanges[index];

      if (isNaN(num)) {
        throw new Error(
          `Invalid cron expression: "${part}" in ${range.name} field`,
        );
      }

      if (num < range.min || num > range.max) {
        throw new Error(
          `Invalid cron expression: ${range.name} must be between ${range.min} and ${range.max}`,
        );
      }
    });
  }
}
