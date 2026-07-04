import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { deleteToken } from '../../cloud/credentials';
import { getProfile, resolveProfileName } from '../../cloud/global-config';

Logger.overrideLogger(false);

interface LogoutOptions {
  profile?: string;
}

export async function logoutCommand(
  options: LogoutOptions = {},
): Promise<void> {
  const profileName = resolveProfileName(options.profile);
  const profile = getProfile(profileName);
  deleteToken(profile.apiBaseUrl);
  logger.success(`Logged out of profile "${profileName}".`);
}
