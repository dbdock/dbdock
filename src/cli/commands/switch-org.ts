import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { setActiveOrg } from '../../cloud/global-config';

Logger.overrideLogger(false);

interface SwitchOrgOptions {
  org?: string;
  profile?: string;
}

export function switchOrgCommand(options: SwitchOrgOptions = {}): void {
  if (!options.org) {
    logger.warn(
      'Organizations are not available yet (accounts are single-scope).',
    );
    logger.info(
      'Pass `--org <id>` to set a forward-compatible value for when orgs ship.',
    );
    return;
  }

  setActiveOrg(options.org, options.profile);
  logger.success(`Active organization set to ${options.org}.`);
}
