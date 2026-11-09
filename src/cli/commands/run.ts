import spawn from 'cross-spawn';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { loadConfigFile } from '@/changes/config-file';
import { GuardedChangeError, runGuardedChange } from '@/changes/guard';
import { sqlSummary } from '@/changes/metadata';
import { detectMigration } from '@/changes/detect';
import type { GuardOptions } from '@/changes/types';
import {
  UNDO_HINT,
  checkpointLine,
  deliveryLines,
  line,
  shortSummary,
} from '@/cli/utils/change-output';

interface RunOptions {
  sql?: string;
  actor?: string;
  agent?: string;
}

// cross-spawn, because on Windows npx, prisma and other tools installed in
// node_modules/.bin are .cmd files, which child_process.spawn cannot start
// without a shell. Elsewhere it is child_process.spawn unchanged.
function runChild(command: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
    let interrupted = false;
    const stop = () => {
      interrupted = true;
      child.kill('SIGTERM');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const cleanup = () => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    };
    child.once('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(
        error.code === 'ENOENT'
          ? new Error(
              `${command[0]} was not found. Is it installed in this project?`,
            )
          : error,
      );
    });
    child.once('close', (code, signal) => {
      cleanup();
      if (code === 0 && !interrupted) resolve();
      else reject(new Error(`Change command failed (${signal ?? code}).`));
    });
  });
}

export async function runCommand(
  command: string[],
  options: RunOptions,
): Promise<void> {
  try {
    if (options.sql && command.length)
      throw new Error('Use either --sql <file> or -- <command>, not both.');
    let toRun = command;
    let detectedFrom: string | undefined;
    if (!options.sql && !command.length) {
      const detected = detectMigration(process.cwd());
      if (!detected)
        throw new Error(
          'Tell DBDock what to run: npx dbdock run -- <your migration command>, or npx dbdock run --sql <file>. Prisma and Drizzle projects are found automatically.',
        );
      toRun = detected.command;
      detectedFrom = detected.source;
    }
    const sql = options.sql ? await readFile(options.sql, 'utf8') : undefined;
    const file = await loadConfigFile(process.cwd());
    if (file?.config.enabled === false) {
      const name = basename(file.path);
      if (sql !== undefined)
        throw new Error(
          `DBDock is off in ${name} (enabled: false), so it does not run SQL files. Turn it on, or run the file with your own tool.`,
        );
      console.log(
        line(
          ' ',
          'DBDock is off',
          `enabled is false in ${name}; no checkpoint`,
        ),
      );
      await runChild(toRun);
      return;
    }
    const metadata: GuardOptions = {
      actor: options.actor,
      actorKind: options.agent ? 'agent' : 'person',
      session: options.agent,
      kind: sql ? 'sql' : 'migration',
      summary: sql ? sqlSummary(sql) : 'Run migration command',
      onCheckpoint: (checkpoint, { durationMs, storage }) => {
        console.log(checkpointLine(checkpoint, durationMs, storage));
        console.log(
          line(
            '→',
            'Running',
            sql !== undefined
              ? `SQL file ${options.sql}`
              : `${toRun.join(' ')}${detectedFrom ? `   (found ${detectedFrom})` : ''}`,
          ),
        );
      },
    };
    const result = await runGuardedChange(async (database) => {
      if (sql !== undefined) await database.execute(sql);
      else await runChild(toRun);
    }, metadata);
    console.log(
      line('✓', 'Change finished', shortSummary(result.record.summary)),
    );
    for (const text of deliveryLines(result.record.id, {
      sent: result.synced,
      reason: result.syncError,
    }))
      (result.synced ? console.log : console.error)(text);
    console.log(UNDO_HINT);
  } catch (error) {
    if (error instanceof GuardedChangeError) {
      const cause =
        error.cause instanceof Error ? error.cause.message : 'Change failed.';
      console.error(line('✗', 'Change failed', cause));
      console.error(
        line(
          ' ',
          'Checkpoint',
          `${error.record.checkpointId} (saved before the change)`,
        ),
      );
      for (const text of deliveryLines(error.record.id, error.delivery))
        console.error(text);
      console.error(line(' ', 'To put it back:', 'npx dbdock undo'));
    } else {
      console.error(error instanceof Error ? error.message : 'Change failed.');
    }
    process.exitCode = 1;
  }
}
