import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { ApiClient, ApiError } from '../../cloud/api-client';
import {
  getProfile,
  readGlobalConfig,
  resolveProfileName,
  writeGlobalConfig,
} from '../../cloud/global-config';
import { setCredential, setToken } from '../../cloud/credentials';
import { loopbackLogin, OAuthTokens } from '../../cloud/oauth';
import { defaultAppBaseUrl } from '../../cloud/constants';

Logger.overrideLogger(false);

interface LoginOptions {
  token?: string;
  web?: boolean;
  profile?: string;
}

function activateProfile(profileName: string): void {
  const profile = getProfile(profileName);
  const config = readGlobalConfig();
  config.profiles[profileName] = profile;
  config.activeProfile = profileName;
  writeGlobalConfig(config);
}

async function announceIdentity(
  apiBaseUrl: string,
  accessToken: string,
  profileName: string,
): Promise<void> {
  try {
    const me = await new ApiClient(apiBaseUrl, accessToken).me();
    logger.success(
      `Logged in as ${me.email || me.userId} (profile: ${profileName})`,
    );
  } catch {
    logger.success(`Logged in (profile: ${profileName})`);
  }
}

async function loginWithManualToken(
  token: string,
  apiBaseUrl: string,
  profileName: string,
): Promise<void> {
  try {
    const me = await new ApiClient(apiBaseUrl, token).me();
    setToken(apiBaseUrl, token);
    activateProfile(profileName);
    logger.success(
      `Logged in as ${me.email || me.userId} (profile: ${profileName})`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      logger.error('Login failed: token was rejected.');
    } else if (err instanceof ApiError) {
      logger.error(`Login failed: server returned HTTP ${err.status}.`);
    } else {
      logger.error(`Login failed: ${(err as Error).message}`);
    }
    process.exitCode = 1;
  }
}

export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);

  const manualToken = options.token || process.env.DBDOCK_TOKEN;
  if (manualToken) {
    await loginWithManualToken(manualToken, profile.apiBaseUrl, profileName);
    return;
  }

  logger.info('Opening your browser to sign in to DBDock…');
  let tokens: OAuthTokens;
  try {
    tokens = await loopbackLogin({
      appBaseUrl: defaultAppBaseUrl(),
      onAuthorizeUrl: (url) => {
        logger.info('If your browser did not open, visit this URL:');
        logger.info(url);
      },
    });
  } catch (err) {
    logger.error(`Login failed: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  setCredential(profile.apiBaseUrl, { type: 'oauth', ...tokens });
  activateProfile(profileName);
  await announceIdentity(profile.apiBaseUrl, tokens.accessToken, profileName);
}
