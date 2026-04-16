import { loadConfig, ScheduleEntry } from '../utils/config';
import { logger } from '../utils/logger';
import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);

export function statusCommand(): Promise<void> {
  return Promise.resolve(runStatusCommand());
}

function runStatusCommand(): void {
  try {
    const config = loadConfig();
    const schedules = config.backup?.schedules || [];

    if (schedules.length === 0) {
      logger.info('\nNo schedules configured');
      logger.info('Run "dbdock schedule" to create schedules\n');
      return;
    }

    logger.info('\n📅 Scheduled Backups:\n');

    const maxNameLength = Math.max(
      ...schedules.map((s: ScheduleEntry) => (s.name || 'Unnamed').length),
      10,
    );
    const maxCronLength = Math.max(
      ...schedules.map((s: ScheduleEntry) => s.cron.length),
      15,
    );

    const header = `┌─────┬─${'─'.repeat(maxNameLength + 2)}┬─${'─'.repeat(maxCronLength + 2)}┬──────────┐`;
    const separator = `├─────┼─${'─'.repeat(maxNameLength + 2)}┼─${'─'.repeat(maxCronLength + 2)}┼──────────┤`;
    const footer = `└─────┴─${'─'.repeat(maxNameLength + 2)}┴─${'─'.repeat(maxCronLength + 2)}┴──────────┘`;

    logger.log(header);
    logger.log(
      `│  #  │ ${'Name'.padEnd(maxNameLength)} │ ${'Cron Expression'.padEnd(maxCronLength)} │ Status   │`,
    );
    logger.log(separator);

    schedules.forEach((schedule: ScheduleEntry, index: number) => {
      const name = (schedule.name || 'Unnamed').padEnd(maxNameLength);
      const cron = schedule.cron.padEnd(maxCronLength);
      const status = (
        schedule.enabled !== false ? '✓ Active' : '✗ Paused'
      ).padEnd(8);
      const num = String(index + 1).padStart(3);

      logger.log(`│ ${num} │ ${name} │ ${cron} │ ${status} │`);
    });

    logger.log(footer);
    logger.log('');

    const enabledCount = schedules.filter(
      (s: ScheduleEntry) => s.enabled !== false,
    ).length;
    const disabledCount = schedules.length - enabledCount;

    logger.info(
      `Total: ${schedules.length} schedule(s) - ${enabledCount} active, ${disabledCount} paused\n`,
    );

    logger.info(
      '💡 Schedules execute only when DBDock is integrated into your NestJS app',
    );
    logger.info('   See: https://docs.dbdock.xyz/sdk/overview\n');
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
