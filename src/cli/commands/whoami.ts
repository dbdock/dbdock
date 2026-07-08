import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { loadSession } from '../../cloud/session';

Logger.overrideLogger(false);

interface WhoamiOptions {
  profile?: string;
}

export async function whoamiCommand(
  options: WhoamiOptions = {},
): Promise<void> {
  const session = await loadSession(options.profile);

  if (!session.token) {
    logger.error('Not logged in. Run `dbdock login`.');
    process.exitCode = 1;
    return;
  }

  try {
    const me = await session.client.me();
    logger.info(`User:    ${me.email || me.userId}`);
    logger.info(`ID:      ${me.userId}`);
    logger.info(`Auth:    ${me.authMethod}`);
    logger.info(
      `Org:     ${session.activeOrg || me.organizationId || '(none)'}`,
    );
    logger.info(`Profile: ${session.profileName} → ${session.apiBaseUrl}`);
    logger.info(`Token:   ${session.token.slice(0, 12)}…`);
  } catch (err) {
    logger.error(`whoami failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
