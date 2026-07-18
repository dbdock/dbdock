import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import { loadSession } from '../../cloud/session';
import { formatCloudError } from '../../cloud/errors';

Logger.overrideLogger(false);

interface StorageOptions {
  profile?: string;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function usageBar(pct: number, width = 24): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}

export async function storageCommand(
  options: StorageOptions = {},
): Promise<void> {
  const session = await loadSession(options.profile);
  if (!session.token) {
    logger.error('Not logged in. Run `dbdock login`.');
    process.exitCode = 1;
    return;
  }

  try {
    const usage = await session.client.getManagedUsage();

    if (!usage.entitled) {
      logger.warn('DBDock managed storage is a Pro & Business feature.');
      logger.info(
        'Upgrade at https://dbdock.xyz/billing to store backups in DBDock.',
      );
      return;
    }

    logger.info('DBDock Managed Storage');
    logger.log(`  ${usageBar(usage.pct)} ${usage.pct}%`);
    logger.log(
      `  ${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used (${usage.quotaGb} GB plan)`,
    );

    if (!usage.configured) {
      logger.warn(
        '\nManaged storage is temporarily unavailable on the server.',
      );
    } else if (usage.configId === null) {
      logger.info(
        '\nNot activated yet. Run `dbdock init` and pick DBDock Storage, or activate from the dashboard.',
      );
    } else if (usage.pct >= 90) {
      logger.warn(
        '\nYou are almost out of space. Delete old backups or upgrade your plan.',
      );
    }
  } catch (err) {
    logger.error(formatCloudError(err));
    process.exitCode = 1;
  }
}
