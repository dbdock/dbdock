#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init';
import { backupCommand } from './commands/backup';
import { restoreCommand } from './commands/restore';
import { testCommand } from './commands/test';
import { scheduleCommand } from './commands/schedule';
import { listCommand } from './commands/list';
import { deleteCommand } from './commands/delete';
import { cleanupCommand } from './commands/cleanup';
import { statusCommand } from './commands/status';
import { migrateConfigCommand } from './commands/migrate-config';
import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
);
const version = packageJson.version;

process.on('SIGINT', () => {
  console.log('\n\nOperation cancelled by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nOperation terminated');
  process.exit(0);
});

const program = new Command();

program
  .name('dbdock')
  .description('Enterprise-grade database backup and restore tool')
  .version(version);

program
  .command('init')
  .description('Initialize DBDock configuration')
  .action(initCommand);

program
  .command('migrate-config')
  .description('Migrate secrets from config file to environment variables')
  .action(migrateConfigCommand);

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

program
  .command('list')
  .description('List all available backups')
  .option('--recent <number>', 'Show most recent N backups', parseInt)
  .option('--search <keyword>', 'Search backups by keyword')
  .option('--days <number>', 'Show backups from last N days', parseInt)
  .option('--limit <number>', 'Limit number of results', parseInt)
  .action(listCommand);

program
  .command('delete')
  .description('Delete backup(s)')
  .option('--all', 'Delete all backups')
  .option('--key <key>', 'Delete specific backup by key')
  .action(deleteCommand);

program
  .command('cleanup')
  .description('Clean up old backups based on retention policy')
  .option('--dry-run', 'Preview what will be deleted without deleting')
  .option('--force', 'Delete without confirmation')
  .action(cleanupCommand);

program
  .command('status')
  .description('View configured backup schedules')
  .action(statusCommand);

program.parse();
