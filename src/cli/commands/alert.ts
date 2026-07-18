import inquirer from 'inquirer';
import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { loadSession, Session } from '../../cloud/session';
import { formatCloudError } from '../../cloud/errors';
import {
  AlertEvent,
  ChannelType,
  NotificationChannel,
} from '../../cloud/types';

Logger.overrideLogger(false);

interface AlertOptions {
  profile?: string;
}

const ALERT_EVENTS: { name: string; value: AlertEvent }[] = [
  { name: 'Backup succeeded', value: 'backup_success' },
  { name: 'Backup failed', value: 'backup_failure' },
  { name: 'Schedule missed', value: 'schedule_missed' },
  { name: 'Storage error', value: 'storage_error' },
];

async function requireSessionOrExit(profile?: string): Promise<Session | null> {
  const session = await loadSession(profile);
  if (!session.token) {
    logger.error('Not logged in. Run `dbdock login`.');
    process.exitCode = 1;
    return null;
  }
  return session;
}

function requireTty(): boolean {
  if (!process.stdin.isTTY) {
    logger.error('This action is interactive and needs a terminal.');
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function list(session: Session): Promise<void> {
  const [channels, alerts] = await Promise.all([
    session.client.listChannels(),
    session.client.listAlerts(),
  ]);

  logger.info('Notification channels:');
  if (channels.length === 0) {
    logger.log('  (none) — add one with `dbdock alert add`');
  } else {
    for (const c of channels) {
      logger.log(`  ${c.name}  [${c.type}]  ${c.id}`);
    }
  }

  logger.info('\nAlert rules:');
  if (alerts.length === 0) {
    logger.log('  (none) — add one with `dbdock alert rule`');
  } else {
    const byId = new Map(channels.map((c) => [c.id, c.name]));
    for (const a of alerts) {
      logger.log(
        `  ${a.name}  on ${a.event}  →  ${byId.get(a.channelId) ?? a.channelId}`,
      );
    }
  }
}

async function addChannel(session: Session): Promise<void> {
  if (!requireTty()) return;

  const { type } = (await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: 'Channel type:',
      choices: [
        { name: 'Email (SMTP)', value: 'email' },
        { name: 'Slack webhook', value: 'slack' },
        { name: 'Generic webhook', value: 'webhook' },
      ],
    },
  ])) as { type: ChannelType };

  const { name } = (await inquirer.prompt([
    { type: 'input', name: 'name', message: 'Channel name:' },
  ])) as { name: string };

  let config: Record<string, unknown>;
  if (type === 'slack') {
    const { webhookUrl } = (await inquirer.prompt([
      { type: 'input', name: 'webhookUrl', message: 'Slack webhook URL:' },
    ])) as { webhookUrl: string };
    config = { webhookUrl };
  } else if (type === 'webhook') {
    const answers = (await inquirer.prompt([
      { type: 'input', name: 'url', message: 'Webhook URL:' },
      { type: 'input', name: 'secret', message: 'Signing secret (optional):' },
    ])) as { url: string; secret: string };
    config = answers.secret
      ? { url: answers.url, secret: answers.secret }
      : { url: answers.url };
  } else {
    const answers = (await inquirer.prompt([
      { type: 'input', name: 'smtpHost', message: 'SMTP host:' },
      { type: 'number', name: 'smtpPort', message: 'SMTP port:', default: 587 },
      { type: 'input', name: 'smtpUser', message: 'SMTP username:' },
      { type: 'password', name: 'smtpPass', message: 'SMTP password:' },
      { type: 'input', name: 'fromAddress', message: 'From address:' },
    ])) as {
      smtpHost: string;
      smtpPort: number;
      smtpUser: string;
      smtpPass: string;
      fromAddress: string;
    };
    config = { ...answers };
  }

  const channel = await session.client.createChannel({ name, type, config });
  logger.success(`Added channel "${channel.name}" (${channel.id}).`);
}

async function pickChannel(
  session: Session,
  message: string,
): Promise<NotificationChannel | null> {
  const channels = await session.client.listChannels();
  if (channels.length === 0) {
    logger.warn('No channels yet. Add one with `dbdock alert add`.');
    return null;
  }
  if (!requireTty()) return null;
  const { id } = (await inquirer.prompt([
    {
      type: 'list',
      name: 'id',
      message,
      choices: channels.map((c) => ({
        name: `${c.name} [${c.type}]`,
        value: c.id,
      })),
    },
  ])) as { id: string };
  return channels.find((c) => c.id === id) ?? null;
}

async function test(session: Session): Promise<void> {
  const channel = await pickChannel(session, 'Send a test to which channel?');
  if (!channel) return;
  await session.client.testChannel(channel.id);
  logger.success(`Sent a test notification to "${channel.name}".`);
}

async function addRule(session: Session): Promise<void> {
  const channel = await pickChannel(session, 'Notify which channel?');
  if (!channel) return;
  const answers = (await inquirer.prompt([
    { type: 'input', name: 'name', message: 'Rule name:' },
    {
      type: 'list',
      name: 'event',
      message: 'Trigger on:',
      choices: ALERT_EVENTS,
    },
  ])) as { name: string; event: AlertEvent };
  const alert = await session.client.createAlert({
    name: answers.name,
    event: answers.event,
    channelId: channel.id,
  });
  logger.success(`Added rule "${alert.name}".`);
}

async function remove(session: Session): Promise<void> {
  if (!requireTty()) return;
  const [channels, alerts] = await Promise.all([
    session.client.listChannels(),
    session.client.listAlerts(),
  ]);
  const choices = [
    ...alerts.map((a) => ({ name: `rule: ${a.name}`, value: `alert:${a.id}` })),
    ...channels.map((c) => ({
      name: `channel: ${c.name} [${c.type}]`,
      value: `channel:${c.id}`,
    })),
  ];
  if (choices.length === 0) {
    logger.info('Nothing to remove.');
    return;
  }
  const { target } = (await inquirer.prompt([
    { type: 'list', name: 'target', message: 'Remove which?', choices },
  ])) as { target: string };
  const [kind, id] = target.split(':');
  if (kind === 'alert') {
    await session.client.deleteAlert(id);
  } else {
    await session.client.deleteChannel(id);
  }
  logger.success('Removed.');
}

export async function alertCommand(
  action = 'list',
  options: AlertOptions = {},
): Promise<void> {
  const session = await requireSessionOrExit(options.profile);
  if (!session) return;

  try {
    switch (action) {
      case 'list':
        await list(session);
        break;
      case 'add':
      case 'add-channel':
        await addChannel(session);
        break;
      case 'rule':
      case 'add-rule':
        await addRule(session);
        break;
      case 'test':
        await test(session);
        break;
      case 'remove':
      case 'rm':
        await remove(session);
        break;
      default:
        logger.error(
          `Unknown alert action "${action}". Use: list | add | rule | test | remove.`,
        );
        process.exitCode = 1;
    }
  } catch (err) {
    logger.error(formatCloudError(err));
    process.exitCode = 1;
  }
}
