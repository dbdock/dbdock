import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { loadSession } from '../../cloud/session';
import { formatCloudError } from '../../cloud/errors';

Logger.overrideLogger(false);

interface AccountOptions {
  profile?: string;
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function limit(value: number): string {
  return value < 0 ? 'unlimited' : String(value);
}

export async function accountCommand(
  options: AccountOptions = {},
): Promise<void> {
  const session = await loadSession(options.profile);
  if (!session.token) {
    logger.error('Not logged in. Run `dbdock login`.');
    process.exitCode = 1;
    return;
  }

  try {
    const [me, ent] = await Promise.all([
      session.client.me(),
      session.client.getEntitlements(),
    ]);

    logger.info(`Account: ${me.email || me.userId}`);
    logger.info(`Plan:    ${ent.plan}${ent.isActive ? '' : ' (inactive)'}`);
    logger.info('');
    logger.info('Limits:');
    logger.log(`  Connections:      ${limit(ent.maxConnections)}`);
    logger.log(`  Backups / month:  ${limit(ent.maxBackupsPerMonth)}`);
    logger.log(
      `  Schedules:        ${ent.schedulesEnabled ? limit(ent.maxSchedules) : 'not on this plan'}`,
    );
    logger.log(`  Encrypted backups:${' '}${yesNo(ent.encryptedBackups)}`);
    logger.log(
      `  Managed storage:  ${ent.managedStorage ? `${ent.managedStorageQuotaGb} GB` : 'not on this plan'}`,
    );
    logger.log(`  Alerts:           ${limit(ent.maxAlerts)}`);
    logger.log(
      `  Alert channels:   email${ent.slackChannels ? ', slack' : ''}${ent.webhookChannels ? ', webhook' : ''}`,
    );
    logger.log(
      `  Team members:     ${ent.teamMembersEnabled ? limit(ent.maxTeamMembers) : 'not on this plan'}`,
    );

    if (ent.plan === 'free') {
      logger.info('\nUpgrade for more: https://dbdock.xyz/billing');
    }
  } catch (err) {
    logger.error(formatCloudError(err));
    process.exitCode = 1;
  }
}
