#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init';
import { backupCommand } from './commands/backup';
import { restoreCommand } from './commands/restore';
import { testCommand } from './commands/test';
import { scheduleCommand } from './commands/schedule';

process.on('SIGINT', () => {
  console.log('\n\n✓ Operation cancelled by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n✓ Operation terminated');
  process.exit(0);
});

const program = new Command();

program
  .name('dbdock')
  .description('Enterprise-grade database backup and restore tool')
  .version('1.1.0');

program
  .command('init')
  .description('Initialize DBDock configuration')
  .action(initCommand);

program
  .command('backup')
  .description('Create a database backup')
  .option('--encrypt', 'Enable encryption for this backup')
  .option('--no-encrypt', 'Disable encryption for this backup')
  .option('--compress', 'Enable compression for this backup')
  .option('--no-compress', 'Disable compression for this backup')
  .option('--encryption-key <key>', 'Encryption key (32 bytes hex)')
  .option('--compression-level <level>', 'Compression level (0-11)', parseInt)
  .action(backupCommand);

program
  .command('restore')
  .description('Restore from a backup')
  .action(restoreCommand);

program
  .command('test')
  .description('Test database and storage configuration')
  .action(testCommand);

program
  .command('schedule')
  .description('Manage backup schedules')
  .action(scheduleCommand);

program.parse();
