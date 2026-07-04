import { Logger } from '@nestjs/common';
import { logger } from '../utils/logger';
import {
  NoProjectError,
  syncPull,
  syncPush,
  syncStatus,
  SyncStatusResult,
} from '../../cloud/sync-engine';
import { NotAuthenticatedError } from '../../cloud/session';

Logger.overrideLogger(false);

interface SyncOptions {
  force?: boolean;
}

export async function syncCommand(
  action?: string,
  options: SyncOptions = {},
): Promise<void> {
  try {
    if (action === 'status') {
      printStatus(await syncStatus());
      return;
    }

    if (action === 'pull') {
      const result = await syncPull();
      logger.success(
        result.upToDate
          ? 'Already up to date with cloud.'
          : `Pulled cloud baseline (revision ${result.remoteRevision}).`,
      );
      return;
    }

    if (action && action !== 'push') {
      logger.error(
        `Unknown sync action "${action}". Use: status | push | pull.`,
      );
      process.exitCode = 1;
      return;
    }

    const result = await syncPush(process.cwd(), { force: options.force });

    if (result.drained.conflict) {
      logger.warn(
        'Cloud has diverged from your local baseline (conflict).',
      );
      logger.info(
        'Resolve with `dbdock sync pull` (adopt cloud) or `dbdock sync --force` (overwrite cloud).',
      );
      process.exitCode = 1;
      return;
    }

    if (result.queued === 0 && result.drained.attempted === 0) {
      logger.info('Nothing to sync — local metadata matches cloud.');
      return;
    }

    logger.success(
      `Synced. ${result.drained.acked} change set(s) pushed` +
        (result.drained.failed ? `, ${result.drained.failed} queued for retry` : '') +
        '.',
    );
  } catch (err) {
    handleSyncError(err);
  }
}

function printStatus(status: SyncStatusResult): void {
  logger.info(`Project:  ${status.projectId}`);
  logger.info(`Local:    revision ${status.localRevision}`);
  logger.info(
    `Cloud:    ${
      status.remoteReachable
        ? `revision ${status.remoteRevision}`
        : 'unreachable (offline)'
    }`,
  );
  logger.info(`Pending:  ${status.pending}`);
  if (status.deadletter > 0) {
    logger.warn(`Dead-letter: ${status.deadletter} job(s) need attention.`);
  }
  logger.info(`Last sync: ${status.lastSync || 'never'}`);
  if (status.remoteReachable) {
    if (status.inSync) {
      logger.success('In sync.');
    } else {
      logger.warn('Out of sync — run `dbdock sync`.');
    }
  }
}

function handleSyncError(err: unknown): void {
  if (err instanceof NotAuthenticatedError || err instanceof NoProjectError) {
    logger.error(err.message);
  } else {
    logger.error(`Sync failed: ${(err as Error).message}`);
  }
  process.exitCode = 1;
}
