#!/usr/bin/env node

import { Command } from 'commander';
import { runCommand } from '@/cli/commands/run';
import { linkCommand } from '@/cli/commands/link';
import { restoreCheckpointCommand } from '@/cli/commands/restore-checkpoint';
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
import { copydbCommand } from './commands/copydb';
import { analyzeCommand } from './commands/analyze';
import { crossMigrateCommand } from './commands/cross-migrate';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { whoamiCommand } from './commands/whoami';
import { switchOrgCommand } from './commands/switch-org';
import { syncCommand } from './commands/sync';
import { openCommand } from './commands/open';
import { accountCommand } from './commands/account';
import { storageCommand } from './commands/storage';
import { alertCommand } from './commands/alert';
import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8'),
) as { version: string };
const version = packageJson.version;

if (!['run', 'restore'].includes(process.argv[2]))
  process.on('SIGINT', () => {
    console.log('\n\nOperation cancelled by user');
    process.exit(0);
  });

if (!['run', 'restore'].includes(process.argv[2]))
  process.on('SIGTERM', () => {
    console.log('\n\nOperation terminated');
    process.exit(0);
  });

const program = new Command();

program
  .name('dbdock')
  .description('Checkpoint database changes and keep a record')
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
  .command('restore [checkpoint-id]')
  .description('Restore a checkpoint or choose an existing backup')
  .option(
    '--yes',
    'Confirm that restore removes writes made after the checkpoint',
  )
  .action(async (id: string | undefined, options: { yes?: boolean }) => {
    if (id) await restoreCheckpointCommand(id, options);
    else await restoreCommand();
  });

program
  .command('link')
  .description(
    'Link this directory to Cloud without sharing database credentials',
  )
  .option('--project <id>', 'Existing project id')
  .option('--name <name>', 'Name for a new project')
  .action(linkCommand);

program
  .command('run')
  .description('Save a checkpoint, run a change locally and keep its record')
  .argument('[command...]', 'Migration command and arguments after --')
  .option('--sql <file>', 'Run a local SQL file')
  .option('--actor <name>', 'Person or agent name')
  .option('--agent <session>', 'Agent session id')
  .action(runCommand);

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

program
  .command('copydb')
  .description('Copy a PostgreSQL database from one URL to another')
  .argument(
    '<source>',
    'Source PostgreSQL URL (postgresql://user:pass@host:port/db)',
  )
  .argument(
    '<target>',
    'Target PostgreSQL URL (postgresql://user:pass@host:port/db)',
  )
  .option('--schema-only', 'Copy schema only (no data)')
  .option('--data-only', 'Copy data only (no schema)')
  .option('--verbose', 'Show detailed output')
  .option(
    '--driver',
    'Use direct PostgreSQL driver instead of pg_dump (works with serverless/modified Postgres)',
  )
  .action(copydbCommand);

program
  .command('analyze')
  .description('Analyze a database structure (MongoDB or PostgreSQL)')
  .argument('<url>', 'Database connection URL (mongodb:// or postgresql://)')
  .action(analyzeCommand);

program
  .command('login')
  .description('Sign in to DBDock Cloud in your browser')
  .option('--token <token>', 'Use a token directly instead of the browser flow')
  .option('--web', 'Sign in via the browser (default)')
  .option('--profile <name>', 'Account profile to log into')
  .action(loginCommand);

program
  .command('logout')
  .description('Remove stored DBDock Cloud credentials')
  .option('--profile <name>', 'Account profile to log out of')
  .action(logoutCommand);

program
  .command('whoami')
  .description('Show the currently authenticated DBDock account')
  .option('--profile <name>', 'Account profile to inspect')
  .action(whoamiCommand);

program
  .command('switch-org')
  .description('Set the active organization (forward-compatible)')
  .option('--org <id>', 'Organization id')
  .option('--profile <name>', 'Account profile')
  .action(switchOrgCommand);

program
  .command('sync [action]')
  .description('Synchronize this project with DBDock Cloud (status|push|pull)')
  .option('--force', 'Overwrite cloud state with local (resolves conflicts)')
  .action(syncCommand);

program
  .command('open')
  .description('Open this project in the DBDock dashboard')
  .option('--print', 'Print the dashboard URL instead of opening a browser')
  .action(openCommand);

program
  .command('account')
  .description('Show your DBDock plan and usage limits')
  .option('--profile <name>', 'Account profile')
  .action(accountCommand);

program
  .command('storage')
  .description('Show DBDock managed storage usage and quota')
  .option('--profile <name>', 'Account profile')
  .action(storageCommand);

program
  .command('alert [action]')
  .description('Manage cloud alerts and channels (list|add|rule|test|remove)')
  .option('--profile <name>', 'Account profile')
  .action(alertCommand);

program
  .command('migrate')
  .description('Cross-database migration between MongoDB and PostgreSQL')
  .argument('<source>', 'Source database URL')
  .argument('<target>', 'Target database URL')
  .option('--dry-run', 'Run migration into temporary schema for validation')
  .option('--incremental', 'Only migrate new/changed data')
  .option('--since <date>', 'Incremental cutoff date (ISO format)')
  .option('--config <path>', 'Use a saved migration config file')
  .option('--export-config <path>', 'Export migration plan to config file')
  .option(
    '--batch-size <number>',
    'Documents per batch (default: 1000)',
    parseInt,
  )
  .option(
    '--max-depth <number>',
    'Max nesting depth before jsonb (default: 2)',
    parseInt,
  )
  .action(crossMigrateCommand);

program.parse();
