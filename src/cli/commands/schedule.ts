import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);

export async function scheduleCommand(): Promise<void> {
  try {
    const config = loadConfig();

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'View current schedules', value: 'view' },
          { name: 'Add new schedule', value: 'add' },
          { name: 'Remove schedule', value: 'remove' },
        ],
      },
    ]);

    if (action === 'view') {
      viewSchedules(config);
    } else if (action === 'add') {
      await addSchedule(config);
    } else if (action === 'remove') {
      await removeSchedule(config);
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function viewSchedules(config: any): void {
  const schedules = config.backup?.schedules || [];

  if (schedules.length === 0) {
    logger.info('No schedules configured');
    logger.info('Run "npx dbdock schedule" and select "Add new schedule" to create one');
    return;
  }

  logger.info('Current schedules:\n');
  schedules.forEach((schedule: any, index: number) => {
    logger.log(`${index + 1}. ${schedule.name || 'Unnamed'}`);
    logger.log(`   Cron: ${schedule.cron}`);
    logger.log(`   Enabled: ${schedule.enabled !== false ? 'Yes' : 'No'}\n`);
  });
}

async function addSchedule(config: any): Promise<void> {
  const answers = await inquirer.prompt([
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
      when: (answers) => answers.preset === 'custom',
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

  const schedule = {
    name: answers.name,
    cron: answers.preset === 'custom' ? answers.customCron : answers.preset,
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

  logger.success('Schedule added successfully');
  logger.info('Note: Schedules require the DBDock service to be running');
}

async function removeSchedule(config: any): Promise<void> {
  const schedules = config.backup?.schedules || [];

  if (schedules.length === 0) {
    logger.info('No schedules to remove');
    return;
  }

  const { selectedIndex } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedIndex',
      message: 'Select schedule to remove:',
      choices: schedules.map((schedule: any, index: number) => ({
        name: `${schedule.name || 'Unnamed'} (${schedule.cron})`,
        value: index,
      })),
    },
  ]);

  const { confirm } = await inquirer.prompt([
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

  config.backup.schedules.splice(selectedIndex, 1);
  saveConfig(config);

  logger.success('Schedule removed successfully');
}
