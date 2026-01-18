import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { logger } from '../utils/logger';
import { Logger } from '@nestjs/common';
import { loadConfig } from '../utils/config';
import { spawn } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import inquirer from 'inquirer';

Logger.overrideLogger(false);

interface StartOptions {
  daemon?: boolean;
  pm2?: boolean;
  logs?: boolean;
}

export async function startCommand(options: StartOptions = {}): Promise<void> {
  try {
    const config = loadConfig();
    const schedules = config.backup?.schedules || [];

    if (schedules.length === 0) {
      logger.warn('No schedules configured');
      logger.info('\nTo create schedules, run:');
      logger.log('  npx dbdock schedule\n');

      const { shouldContinue } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldContinue',
          message: 'Start DBDock service anyway (for future schedules)?',
          default: false,
        },
      ]);

      if (!shouldContinue) {
        logger.info('Cancelled. Create schedules first with "npx dbdock schedule"');
        return;
      }
    }

    const enabledSchedules = schedules.filter((s: any) => s.enabled !== false);

    if (enabledSchedules.length === 0 && schedules.length > 0) {
      logger.warn('All schedules are disabled');
      logger.info('\nTo enable schedules, run:');
      logger.log('  npx dbdock schedule\n');
    }

    if (!options.pm2 && !options.daemon) {
      logger.info('\nSelect how to run DBDock scheduler service:\n');

      const { startMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'startMode',
          message: 'Choose service mode:',
          choices: [
            {
              name: '🚀 PM2 (recommended) - Background with auto-restart',
              value: 'pm2',
            },
            {
              name: '⚙️  Daemon - Simple background process',
              value: 'daemon',
            },
          ],
        },
      ]);

      if (startMode === 'pm2') {
        options.pm2 = true;
      } else {
        options.daemon = true;
      }
    }

    await startDaemon(options);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function startDaemon(options: StartOptions): Promise<void> {
  if (options.pm2) {
    await startWithPM2();
  } else {
    await startAsBackgroundProcess();
  }
}

async function startWithPM2(): Promise<void> {
  try {
    const pm2Check = spawn('pm2', ['--version'], { stdio: 'pipe' });

    await new Promise<void>((resolve, reject) => {
      pm2Check.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('PM2 not found'));
        }
      });
      pm2Check.on('error', () => reject(new Error('PM2 not found')));
    });
  } catch {
    logger.error('PM2 is not installed');
    logger.info('\nTo install PM2:');
    logger.log('  npm install -g pm2\n');

    const { installPM2 } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'installPM2',
        message: 'Would you like to install PM2 now?',
        default: true,
      },
    ]);

    if (installPM2) {
      logger.info('Installing PM2...');
      const install = spawn('npm', ['install', '-g', 'pm2'], { stdio: 'inherit' });

      await new Promise<void>((resolve, reject) => {
        install.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('Failed to install PM2'));
          }
        });
      });

      logger.success('PM2 installed successfully');
    } else {
      logger.info('Cancelled. Install PM2 manually or run with --daemon flag');
      return;
    }
  }

  let existingProcess: any = null;
  try {
    const pm2List = spawn('pm2', ['jlist'], { stdio: 'pipe' });
    let output = '';

    pm2List.stdout.on('data', (data) => {
      output += data.toString();
    });

    await new Promise<void>((resolve) => {
      pm2List.on('close', () => resolve());
    });

    const processes = JSON.parse(output);
    existingProcess = processes.find((p: any) => p.name === 'dbdock');
  } catch (error) {
  }

  if (existingProcess) {
    logger.warn('DBDock service is already running with PM2');
    logger.info(`Status: ${existingProcess.pm2_env?.status}`);
    logger.info(`PID: ${existingProcess.pid}\n`);

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '🔄 Restart service (apply config changes)', value: 'restart' },
          { name: '⏹️  Stop service', value: 'stop' },
          { name: '❌ Cancel', value: 'cancel' },
        ],
      },
    ]);

    if (action === 'restart') {
      logger.info('Restarting DBDock service...');
      const restart = spawn('pm2', ['restart', 'dbdock'], { stdio: 'inherit' });

      await new Promise<void>((resolve) => {
        restart.on('close', () => resolve());
      });

      logger.success('\nDBDock service restarted successfully');
      logger.info('\nUseful PM2 commands:');
      logger.log('  pm2 status          - View service status');
      logger.log('  pm2 logs dbdock     - View logs');
      logger.log('  pm2 stop dbdock     - Stop service');
      logger.log('  pm2 monit           - Monitor service\n');
      return;
    } else if (action === 'stop') {
      logger.info('Stopping DBDock service...');
      const stop = spawn('pm2', ['delete', 'dbdock'], { stdio: 'inherit' });

      await new Promise<void>((resolve) => {
        stop.on('close', () => resolve());
      });

      logger.success('DBDock service stopped and removed from PM2');
      return;
    } else {
      logger.info('Cancelled');
      return;
    }
  }

  const ecosystem = {
    apps: [
      {
        name: 'dbdock',
        script: 'npx',
        args: 'dbdock start',
        cwd: process.cwd(),
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '500M',
        env: {
          NODE_ENV: 'production',
        },
        error_file: join(process.cwd(), 'logs', 'dbdock-error.log'),
        out_file: join(process.cwd(), 'logs', 'dbdock-out.log'),
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      },
    ],
  };

  const ecosystemPath = join(process.cwd(), 'dbdock.ecosystem.json');
  writeFileSync(ecosystemPath, JSON.stringify(ecosystem, null, 2));

  logger.info('Starting DBDock with PM2...\n');

  const pm2Start = spawn('pm2', ['start', ecosystemPath], { stdio: 'inherit' });

  await new Promise<void>((resolve, reject) => {
    pm2Start.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Failed to start with PM2'));
      }
    });
  });

  logger.success('\nDBDock service started with PM2');
  logger.info('\nUseful PM2 commands:');
  logger.log('  pm2 status          - View service status');
  logger.log('  pm2 logs dbdock     - View logs');
  logger.log('  pm2 restart dbdock  - Restart service');
  logger.log('  pm2 stop dbdock     - Stop service');
  logger.log('  pm2 delete dbdock   - Remove service');
  logger.log('  pm2 monit           - Monitor service\n');
}

async function startAsBackgroundProcess(): Promise<void> {
  const pidFile = join(process.cwd(), 'dbdock.pid');

  if (existsSync(pidFile)) {
    logger.warn('DBDock service may already be running');
    logger.info('PID file exists: dbdock.pid');

    const { shouldContinue } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldContinue',
        message: 'Start anyway (will overwrite PID file)?',
        default: false,
      },
    ]);

    if (!shouldContinue) {
      logger.info('Cancelled');
      return;
    }
  }

  logger.info('Starting DBDock as background process...\n');

  const child = spawn(
    process.execPath,
    [process.argv[1], 'start'],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        DBDOCK_DAEMON: 'true',
      },
    }
  );

  child.unref();

  writeFileSync(pidFile, child.pid?.toString() || '');

  logger.success('DBDock service started in background');
  logger.info(`PID: ${child.pid}`);
  logger.info(`PID file: ${pidFile}\n`);
  logger.info('To stop the service:');
  logger.log(`  kill ${child.pid}\n`);
}
