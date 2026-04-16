import inquirer from 'inquirer';
import { loadConfig, saveConfig, CLIConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);

type Schedule = {
  name: string;
  cron: string;
  enabled: boolean;
};

interface ActionAnswer {
  action: 'view' | 'add' | 'remove' | 'toggle';
}

interface AddScheduleAnswers {
  name: string;
  preset: string;
  customCron?: string;
  enabled: boolean;
}

interface SelectedIndexAnswer {
  selectedIndex: number;
}

interface ConfirmAnswer {
  confirm: boolean;
}

export async function scheduleCommand(): Promise<void> {
  try {
    const config = loadConfig();

    const { action } = await inquirer.prompt<ActionAnswer>([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'View current schedules', value: 'view' },
          { name: 'Add new schedule', value: 'add' },
          { name: 'Remove schedule', value: 'remove' },
          { name: 'Toggle schedule (enable/disable)', value: 'toggle' },
        ],
      },
    ]);

    if (action === 'view') {
      viewSchedules(config);
    } else if (action === 'add') {
      await addSchedule(config);
    } else if (action === 'remove') {
      await removeSchedule(config);
    } else if (action === 'toggle') {
      await toggleSchedule(config);
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function viewSchedules(config: CLIConfig): void {
  const schedules: Schedule[] = config.backup?.schedules || [];

  if (schedules.length === 0) {
    logger.info('No schedules configured');
    logger.info(
      'Run "npx dbdock schedule" and select "Add new schedule" to create one',
    );
    return;
  }

  logger.info('\nScheduled Backups:\n');

  const maxNameLength = Math.max(
    ...schedules.map((s) => (s.name || 'Unnamed').length),
    10,
  );
  const maxCronLength = Math.max(...schedules.map((s) => s.cron.length), 15);

  const header = `┌─────┬─${'─'.repeat(maxNameLength + 2)}┬─${'─'.repeat(maxCronLength + 2)}┬──────────┐`;
  const separator = `├─────┼─${'─'.repeat(maxNameLength + 2)}┼─${'─'.repeat(maxCronLength + 2)}┼──────────┤`;
  const footer = `└─────┴─${'─'.repeat(maxNameLength + 2)}┴─${'─'.repeat(maxCronLength + 2)}┴──────────┘`;

  logger.log(header);
  logger.log(
    `│  #  │ ${'Name'.padEnd(maxNameLength)} │ ${'Cron Expression'.padEnd(maxCronLength)} │ Status   │`,
  );
  logger.log(separator);

  schedules.forEach((schedule, index) => {
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
}

async function addSchedule(config: CLIConfig): Promise<void> {
  const answers = await inquirer.prompt<AddScheduleAnswers>([
    {
      type: 'input',
      name: 'name',
      message: 'Schedule name:',
      default: 'Daily Backup',
    },
    {
      type: 'list',
      name: 'preset',
      message: 'Select schedule preset:',
      choices: [
        { name: 'Every hour', value: '0 * * * *' },
        { name: 'Every day at midnight', value: '0 0 * * *' },
        { name: 'Every day at 2 AM', value: '0 2 * * *' },
        { name: 'Every week (Sunday at midnight)', value: '0 0 * * 0' },
        { name: 'Every month (1st at midnight)', value: '0 0 1 * *' },
        { name: 'Custom cron expression', value: 'custom' },
      ],
    },
    {
      type: 'input',
      name: 'customCron',
      message: 'Enter cron expression (e.g., "0 2 * * *"):',
      when: (answers: AddScheduleAnswers) => answers.preset === 'custom',
      validate: (input: string) => {
        const parts = input.trim().split(' ');
        if (parts.length !== 5) {
          return 'Cron expression must have 5 parts (minute hour day month weekday)';
        }
        return true;
      },
    },
    {
      type: 'confirm',
      name: 'enabled',
      message: 'Enable this schedule immediately?',
      default: true,
    },
  ]);

  const schedule: Schedule = {
    name: answers.name,
    cron:
      answers.preset === 'custom' ? answers.customCron || '' : answers.preset,
    enabled: answers.enabled,
  };

  if (!config.backup) {
    config.backup = {};
  }
  if (!config.backup.schedules) {
    config.backup.schedules = [];
  }

  config.backup.schedules.push(schedule);
  saveConfig(config);

  logger.success('\n✔ Schedule added successfully');
  logger.log(`  Name: ${schedule.name}`);
  logger.log(`  Cron: ${schedule.cron}`);
  logger.log(`  Status: ${schedule.enabled ? 'Enabled' : 'Disabled'}\n`);

  logger.info(
    '💡 To execute schedules, integrate DBDock into your NestJS application',
  );
  logger.info('   See: https://docs.dbdock.xyz');
}

async function removeSchedule(config: CLIConfig): Promise<void> {
  const schedules: Schedule[] = config.backup?.schedules || [];

  if (schedules.length === 0) {
    logger.info('No schedules to remove');
    return;
  }

  const { selectedIndex } = await inquirer.prompt<SelectedIndexAnswer>([
    {
      type: 'list',
      name: 'selectedIndex',
      message: 'Select schedule to remove:',
      choices: schedules.map((schedule, index) => ({
        name: `${schedule.name || 'Unnamed'} (${schedule.cron})`,
        value: index,
      })),
    },
  ]);

  const { confirm } = await inquirer.prompt<ConfirmAnswer>([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to remove this schedule?',
      default: false,
    },
  ]);

  if (!confirm) {
    logger.warn('Removal cancelled');
    return;
  }

  if (!config.backup || !config.backup.schedules) {
    logger.error('No schedules found in config');
    return;
  }

  config.backup.schedules.splice(selectedIndex, 1);
  saveConfig(config);

  logger.success('Schedule removed successfully');
}

async function toggleSchedule(config: CLIConfig): Promise<void> {
  const schedules: Schedule[] = config.backup?.schedules || [];

  if (schedules.length === 0) {
    logger.info('No schedules to toggle');
    return;
  }

  const { selectedIndex } = await inquirer.prompt<SelectedIndexAnswer>([
    {
      type: 'list',
      name: 'selectedIndex',
      message: 'Select schedule to enable/disable:',
      choices: schedules.map((schedule, index) => ({
        name: `${schedule.name || 'Unnamed'} (${schedule.cron}) - ${schedule.enabled !== false ? 'Enabled' : 'Disabled'}`,
        value: index,
      })),
    },
  ]);

  const schedule = schedules[selectedIndex];
  if (!schedule) {
    logger.error('Invalid schedule selected');
    return;
  }
  const currentStatus = schedule.enabled !== false;

  schedule.enabled = !currentStatus;
  saveConfig(config);

  logger.success(
    `\n✔ Schedule ${currentStatus ? 'disabled' : 'enabled'}: ${schedule.name}`,
  );
}
