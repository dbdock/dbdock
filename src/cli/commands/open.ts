import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { readProjectConfig } from '../../cloud/project-config';
import { buildDashboardUrl, openUrl } from '../../cloud/open-url';

Logger.overrideLogger(false);

interface OpenOptions {
  print?: boolean;
}

export async function openCommand(options: OpenOptions = {}): Promise<void> {
  const config = readProjectConfig();
  if (!config?.projectId) {
    logger.error('No linked project. Run `dbdock init` first.');
    process.exitCode = 1;
    return;
  }

  const url = buildDashboardUrl(config.projectId, config.organizationId);

  if (options.print) {
    logger.log(url);
    return;
  }

  try {
    await openUrl(url);
    logger.success(`Opening ${url}`);
  } catch {
    logger.warn('Could not launch a browser. Open this URL manually:');
    logger.log(url);
  }
}
