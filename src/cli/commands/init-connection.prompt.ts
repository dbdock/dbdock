import inquirer from 'inquirer';
import { logger } from '../utils/logger';
import { getEngine } from '../../engines';
import {
  DB_TYPE_CHOICES,
  ResolvedConnection,
  detectConnectionUrlFromEnv,
  detectConnectionVarsFromEnv,
  formatConnectionDisplay,
  parseConnectionUrl,
} from './init-connection';

function printParsed(conn: ResolvedConnection): void {
  logger.info('\nParsed connection:');
  logger.log(`  Type:     ${conn.type}`);
  logger.log(`  Host:     ${conn.host}:${conn.port}`);
  logger.log(`  User:     ${conn.username || '(none)'}`);
  logger.log(`  Database: ${conn.database || '(none)'}`);
}

export async function resolveDatabaseConnection(): Promise<ResolvedConnection> {
  const detected = detectConnectionUrlFromEnv();
  if (detected) {
    logger.info(
      `\nFound a database connection in your environment (${detected.envVar}):`,
    );
    logger.log(
      `  ${formatConnectionDisplay(detected.connection, { maskPassword: true })}`,
    );
    const { useDetected } = (await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useDetected',
        message: 'Use this connection?',
        default: true,
      },
    ])) as { useDetected: boolean };
    if (useDetected) {
      return detected.connection;
    }
  }

  const { method } = (await inquirer.prompt([
    {
      type: 'list',
      name: 'method',
      message: 'How would you like to configure your database connection?',
      choices: [
        {
          name: 'Paste a connection URL  (postgresql://…, mysql://…, redis://…)',
          value: 'url',
        },
        { name: 'Enter connection details manually', value: 'manual' },
      ],
      default: 'url',
    },
  ])) as { method: 'url' | 'manual' };

  if (method === 'url') {
    const { url } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Connection URL:',
        validate: (input: string) => {
          try {
            parseConnectionUrl(input);
            return true;
          } catch (err) {
            return (err as Error).message;
          }
        },
      },
    ])) as { url: string };
    const connection = parseConnectionUrl(url);
    printParsed(connection);
    return connection;
  }

  const defaults = detectConnectionVarsFromEnv();
  const manual = (await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: 'Database type:',
      choices: DB_TYPE_CHOICES,
      default: 'postgres',
    },
    {
      type: 'input',
      name: 'host',
      message: 'Host:',
      default: defaults.host ?? 'localhost',
    },
    {
      type: 'number',
      name: 'port',
      message: 'Port:',
      default: (ans: { type?: string }) =>
        defaults.port ?? getEngine(ans.type).defaultPort,
    },
    {
      type: 'input',
      name: 'username',
      message: 'Username:',
      default: (ans: { type?: string }) =>
        defaults.username ?? getEngine(ans.type).defaultUser,
    },
    {
      type: 'password',
      name: 'password',
      message:
        'Password (press Enter to skip and set via DBDOCK_DB_PASSWORD env var):',
    },
    {
      type: 'input',
      name: 'database',
      message: 'Database name:',
      default: defaults.database,
    },
  ])) as {
    type: string;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };

  return {
    type: manual.type,
    host: manual.host,
    port: manual.port,
    username: manual.username,
    password: manual.password ?? '',
    database: manual.database ?? '',
  };
}
