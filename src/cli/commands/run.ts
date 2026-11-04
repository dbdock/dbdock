import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { runGuardedChange } from '@/changes/guard';
import { sqlSummary } from '@/changes/metadata';
import type { GuardOptions } from '@/changes/types';

interface RunOptions {
  sql?: string;
  actor?: string;
  agent?: string;
}

export async function runCommand(
  command: string[],
  options: RunOptions,
): Promise<void> {
  try {
    if ((!options.sql && !command.length) || (options.sql && command.length))
      throw new Error(
        'Use dbdock run --sql <file>, or dbdock run -- <command>.',
      );
    const sql = options.sql ? await readFile(options.sql, 'utf8') : undefined;
    const metadata: GuardOptions = {
      actor: options.actor,
      actorKind: options.agent ? 'agent' : 'person',
      session: options.agent,
      kind: sql ? 'sql' : 'migration',
      summary: sql ? sqlSummary(sql) : 'Run migration command',
    };
    const result = await runGuardedChange(async (database) => {
      if (sql !== undefined) {
        await database.execute(sql);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command[0], command.slice(1), {
          stdio: 'inherit',
          shell: false,
        });
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
        child.once('error', (error) => {
          cleanup();
          reject(error);
        });
        child.once('close', (code, signal) => {
          cleanup();
          if (code === 0 && !interrupted) resolve();
          else reject(new Error(`Change command failed (${signal ?? code}).`));
        });
      });
    }, metadata);
    console.log(
      `Checkpoint: ${result.record.checkpointId}\nRecord: ${result.record.id}`,
    );
    if (!result.synced)
      console.error(
        'Record saved locally. Link this project and run dbdock sync to send it to Cloud.',
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Change failed.');
    process.exitCode = 1;
  }
}
