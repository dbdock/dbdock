import inquirer from 'inquirer';
import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { ApiClient, ApiError } from '../../cloud/api-client';
import {
  getProfile,
  readGlobalConfig,
  resolveProfileName,
  writeGlobalConfig,
} from '../../cloud/global-config';
import { setToken } from '../../cloud/credentials';
import { openUrl } from '../../cloud/open-url';
import { defaultAppBaseUrl } from '../../cloud/constants';

Logger.overrideLogger(false);

interface LoginOptions {
  token?: string;
  web?: boolean;
  profile?: string;
}

export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  let token = options.token || process.env.DBDOCK_TOKEN;

  if (!token && options.web) {
    const url = `${defaultAppBaseUrl()}/settings/api-keys`;
    logger.info(`Opening ${url}`);
    logger.info('Create a personal access token, then paste it below.');
    await openUrl(url).catch(() => undefined);
  }

  if (!token) {
    const answer = (await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: 'Paste your DBDock personal access token (dbd_...):',
      },
    ])) as { token: string };
    token = answer.token?.trim();
  }

  if (!token) {
    logger.error('No token provided.');
    process.exitCode = 1;
    return;
  }

  const client = new ApiClient(profile.apiBaseUrl, token);
  try {
    const me = await client.me();
    setToken(profile.apiBaseUrl, token);

    const config = readGlobalConfig();
    config.profiles[profileName] = profile;
    config.activeProfile = profileName;
    writeGlobalConfig(config);

    logger.success(
      `Logged in as ${me.email || me.userId} (profile: ${profileName})`,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        logger.error(
          'Login failed: token was rejected. Check you pasted a valid, non-revoked dbd_ key.',
        );
      } else if (err.status === 404) {
        logger.error(
          `Login failed: ${profile.apiBaseUrl} has no /auth/me endpoint (HTTP 404).`,
        );
        logger.info(
          'The sync backend may not be deployed yet, or DBDOCK_API_URL points at the wrong server.',
        );
      } else {
        logger.error(`Login failed: server returned HTTP ${err.status}.`);
      }
    } else {
      logger.error(`Login failed: ${(err as Error).message}`);
    }
    process.exitCode = 1;
  }
}
