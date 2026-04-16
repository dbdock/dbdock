import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';
import { driverCopyCommand } from './driver-copy';
import { URL } from 'url';

interface CopyDbOptions {
  schemaOnly?: boolean;
  dataOnly?: boolean;
  verbose?: boolean;
  driver?: boolean;
}

interface DbConnectionInfo {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

function parsePostgresUrl(urlString: string): DbConnectionInfo {
  try {
    const url = new URL(urlString);

    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
      throw new Error(
        `Invalid protocol "${url.protocol}". Expected "postgresql://" or "postgres://"`,
      );
    }

    const host = url.hostname || 'localhost';
    const port = url.port || '5432';
    const user = decodeURIComponent(url.username || 'postgres');
    const password = decodeURIComponent(url.password || '');
    const database = url.pathname.replace(/^\//, '') || 'postgres';

    if (!database || database === '/') {
      throw new Error('Database name is required in the URL');
    }

    return { host, port, user, password, database };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Invalid URL format. Expected: postgresql://user:password@host:port/database`,
      );
    }
    throw error;
  }
}

function maskPassword(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

async function getTableCount(conn: DbConnectionInfo): Promise<number> {
  return new Promise((resolve) => {
    const psqlArgs = [
      '-h',
      conn.host,
      '-p',
      conn.port,
      '-U',
      conn.user,
      '-d',
      conn.database,
      '-t',
      '-A',
      '--no-password',
      '-c',
      `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`,
    ];

    const env = { ...process.env, PGPASSWORD: conn.password };
    const proc = spawn('psql', psqlArgs, { env });

    let output = '';
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(parseInt(output.trim()) || 0);
      } else {
        resolve(-1);
      }
    });
    proc.on('error', () => resolve(-1));
  });
}

async function getDatabaseSize(conn: DbConnectionInfo): Promise<string> {
  return new Promise((resolve) => {
    const psqlArgs = [
      '-h',
      conn.host,
      '-p',
      conn.port,
      '-U',
      conn.user,
      '-d',
      conn.database,
      '-t',
      '-A',
      '--no-password',
      '-c',
      `SELECT pg_size_pretty(pg_database_size('${conn.database}'))`,
    ];

    const env = { ...process.env, PGPASSWORD: conn.password };
    const proc = spawn('psql', psqlArgs, { env });

    let output = '';
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim() || 'Unknown');
      } else {
        resolve('Unknown');
      }
    });
    proc.on('error', () => resolve('Unknown'));
  });
}

async function testConnection(
  conn: DbConnectionInfo,
  label: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const psqlArgs = [
      '-h',
      conn.host,
      '-p',
      conn.port,
      '-U',
      conn.user,
      '-d',
      conn.database,
      '-t',
      '-A',
      '--no-password',
      '-c',
      'SELECT 1',
    ];

    const env = { ...process.env, PGPASSWORD: conn.password };
    const proc = spawn('psql', psqlArgs, { env });

    let errorOutput = '';
    proc.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        logger.error(`${label} connection failed: ${errorOutput.trim()}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });

    proc.on('error', (err) => {
      if (err.message.includes('ENOENT')) {
        logger.error(
          `"psql" not found. Please install PostgreSQL client tools.`,
        );
      } else {
        logger.error(`${label} connection error: ${err.message}`);
      }
      resolve(false);
    });
  });
}

export async function copydbCommand(
  sourceUrl: string,
  targetUrl: string,
  options: CopyDbOptions,
): Promise<void> {
  if (options.driver) {
    return driverCopyCommand(sourceUrl, targetUrl, options);
  }

  console.log('');
  console.log(chalk.bold('  DBDock - Database Copy'));
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log('');

  let source: DbConnectionInfo;
  let target: DbConnectionInfo;

  try {
    source = parsePostgresUrl(sourceUrl);
  } catch (error) {
    logger.error(
      `Source URL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  try {
    target = parsePostgresUrl(targetUrl);
  } catch (error) {
    logger.error(
      `Target URL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  if (sourceUrl === targetUrl) {
    logger.error('Source and target URLs cannot be the same');
    process.exit(1);
  }

  const spinner = ora('Testing connections...').start();

  const [sourceOk, targetOk] = await Promise.all([
    testConnection(source, 'Source'),
    testConnection(target, 'Target'),
  ]);

  if (!sourceOk || !targetOk) {
    spinner.fail('Connection test failed');
    process.exit(1);
  }

  spinner.succeed('Both connections verified');

  const [sourceSize, sourceTables, targetTables] = await Promise.all([
    getDatabaseSize(source),
    getTableCount(source),
    getTableCount(target),
  ]);

  console.log('');
  logger.info('Source Database:');
  logger.log(`  Host:     ${source.host}:${source.port}`);
  logger.log(`  Database: ${source.database}`);
  logger.log(`  User:     ${source.user}`);
  logger.log(`  Size:     ${sourceSize}`);
  if (sourceTables >= 0) logger.log(`  Tables:   ${sourceTables}`);

  console.log('');
  logger.info('Target Database:');
  logger.log(`  Host:     ${target.host}:${target.port}`);
  logger.log(`  Database: ${target.database}`);
  logger.log(`  User:     ${target.user}`);
  if (targetTables >= 0) logger.log(`  Tables:   ${targetTables}`);

  console.log('');

  let mode = 'Full copy (schema + data)';
  if (options.schemaOnly) mode = 'Schema only';
  if (options.dataOnly) mode = 'Data only';
  logger.info(`Mode: ${mode}`);

  if (targetTables > 0) {
    logger.warn(
      `Target database has ${targetTables} existing table(s). They will be overwritten.`,
    );
  }

  console.log('');

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Copy ${source.database} → ${target.database}?`,
      default: false,
    },
  ]);

  if (!confirm) {
    logger.warn('Copy cancelled');
    return;
  }

  console.log('');
  const startTime = Date.now();
  const copySpinner = ora('Starting database copy...').start();

  const pgDumpArgs = [
    '-h',
    source.host,
    '-p',
    source.port,
    '-U',
    source.user,
    '-d',
    source.database,
    '--format=custom',
    '--no-password',
  ];

  if (options.schemaOnly) pgDumpArgs.push('--schema-only');
  if (options.dataOnly) pgDumpArgs.push('--data-only');
  if (options.verbose) pgDumpArgs.push('--verbose');

  const pgRestoreArgs = [
    '-h',
    target.host,
    '-p',
    target.port,
    '-U',
    target.user,
    '-d',
    target.database,
    '-F',
    'c',
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    '--no-password',
  ];

  if (options.dataOnly) {
    const dataRestoreIdx = pgRestoreArgs.indexOf('--clean');
    if (dataRestoreIdx !== -1) pgRestoreArgs.splice(dataRestoreIdx, 2);
  }

  if (options.verbose) pgRestoreArgs.push('--verbose');

  const sourceEnv = { ...process.env, PGPASSWORD: source.password };
  const targetEnv = { ...process.env, PGPASSWORD: target.password };

  try {
    await new Promise<void>((resolve, reject) => {
      const pgDump = spawn('pg_dump', pgDumpArgs, { env: sourceEnv });
      const pgRestore = spawn('pg_restore', pgRestoreArgs, { env: targetEnv });

      let dumpError = '';
      let restoreError = '';
      let bytesTransferred = 0;

      pgDump.on('error', (err) => {
        if (err.message.includes('ENOENT')) {
          reject(
            new Error(
              '"pg_dump" not found. Please install PostgreSQL client tools.',
            ),
          );
        } else {
          reject(new Error(`pg_dump error: ${err.message}`));
        }
      });

      pgRestore.on('error', (err) => {
        if (err.message.includes('ENOENT')) {
          reject(
            new Error(
              '"pg_restore" not found. Please install PostgreSQL client tools.',
            ),
          );
        } else {
          reject(new Error(`pg_restore error: ${err.message}`));
        }
      });

      pgDump.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (!msg.includes('NOTICE') && !msg.includes('WARNING')) {
          dumpError += msg;
        }
      });

      const ignoredPatterns = [
        'NOTICE',
        'WARNING',
        'transaction_timeout',
        'errors ignored on restore',
        'unrecognized configuration parameter',
        'already exists',
        'does not exist',
        'no privileges could be revoked',
        'no privileges were granted',
        'role',
        'extension',
        'schema',
        'procedural language',
      ];

      pgRestore.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().toLowerCase();
        const isIgnorable = ignoredPatterns.some((p) =>
          msg.includes(p.toLowerCase()),
        );
        if (!isIgnorable && data.toString().trim()) {
          restoreError += data.toString();
        }
      });

      pgDump.stdout.on('data', (chunk: Buffer) => {
        bytesTransferred += chunk.length;
        const mb = (bytesTransferred / 1024 / 1024).toFixed(2);
        copySpinner.text = `Copying database... ${mb} MB transferred`;
      });

      pgDump.stdout.pipe(pgRestore.stdin);

      pgDump.on('close', (code) => {
        if (code !== 0 && dumpError) {
          pgRestore.kill();
          reject(
            new Error(`pg_dump failed (code ${code}): ${dumpError.trim()}`),
          );
        }
      });

      pgRestore.on('close', (code) => {
        if (code === 0 || code === 1) {
          resolve();
        } else {
          reject(
            new Error(
              restoreError
                ? `pg_restore failed (code ${code}): ${restoreError.trim()}`
                : `pg_restore exited with code ${code}`,
            ),
          );
        }
      });
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    copySpinner.succeed(`Database copied successfully in ${elapsed}s`);

    console.log('');
    logger.success(`${source.database} → ${target.database} complete`);
    console.log('');
    logger.info('Target connection:');
    logger.log(`  ${maskPassword(targetUrl)}`);
    console.log('');
  } catch (error) {
    copySpinner.fail('Database copy failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
