import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { brotliCompressSync } from 'zlib';
import type { CLIConfig } from '../cli/utils/config';
import { postgresEngine } from '../engines/postgres.engine';
import { restoreBackupStandalone } from './restore-standalone';

const events: string[] = [];
let restoreScript = '';

const recordReset = (): Promise<void> => {
  events.push('reset');
  return Promise.resolve();
};

jest.mock('../engines', () => ({
  getEngine: () => ({
    ...jest.requireActual<typeof import('../engines/postgres.engine')>(
      '../engines/postgres.engine',
    ).postgresEngine,
    spawnRestore: () => {
      events.push('spawn');
      return spawn(process.execPath, ['-e', restoreScript]);
    },
  }),
}));

function exitWith(code: number, stderr: string): string {
  return `process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write(${JSON.stringify(stderr)});process.exitCode=${code}})`;
}

describe('restoreBackupStandalone guards', () => {
  let dir: string;

  const configFor = (compressed: boolean): CLIConfig => ({
    database: { type: 'postgresql', database: 'app' },
    storage: { provider: 'local', local: { path: dir } },
    backup: { compression: { enabled: compressed } },
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dbdock-restore-spec-'));
    events.length = 0;
    restoreScript = exitWith(0, '');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs beforeRestore after the backup decodes and before the restore starts', async () => {
    writeFileSync(join(dir, 'ok.bin'), brotliCompressSync(Buffer.from('dump')));
    const stages: string[] = [];
    await restoreBackupStandalone(
      configFor(true),
      {
        storageKey: 'ok.bin',
        beforeRestore: recordReset,
      },
      { onStage: (stage) => stages.push(stage) },
    );
    expect(events).toEqual(['reset', 'spawn']);
    expect(stages).toEqual([
      'Downloading backup',
      'Verifying backup',
      'Preparing target database',
      'Decompressing backup',
      'Restoring to database',
    ]);
  });

  it('leaves the target untouched when the backup does not decode', async () => {
    writeFileSync(join(dir, 'corrupt.bin'), Buffer.from('not brotli at all'));
    await expect(
      restoreBackupStandalone(configFor(true), {
        storageKey: 'corrupt.bin',
        beforeRestore: recordReset,
      }),
    ).rejects.toThrow(/left untouched/);
    expect(events).toEqual([]);
  });

  it('does not run beforeRestore when the backup is missing', async () => {
    await expect(
      restoreBackupStandalone(configFor(false), {
        storageKey: 'missing.bin',
        beforeRestore: recordReset,
      }),
    ).rejects.toThrow(/not found/);
    expect(events).toEqual([]);
  });

  it('does not start the restore when beforeRestore fails', async () => {
    writeFileSync(join(dir, 'ok.bin'), Buffer.from('dump'));
    await expect(
      restoreBackupStandalone(configFor(false), {
        storageKey: 'ok.bin',
        beforeRestore: () => Promise.reject(new Error('reset refused')),
      }),
    ).rejects.toThrow('reset refused');
    expect(events).toEqual([]);
  });

  describe('strict', () => {
    beforeEach(() => {
      writeFileSync(join(dir, 'ok.bin'), Buffer.from('dump'));
    });

    it('accepts pg_restore exit 1 when every error is harmless', async () => {
      restoreScript = exitWith(
        1,
        'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"\npg_restore: warning: errors ignored on restore: 1\n',
      );
      await expect(
        restoreBackupStandalone(configFor(false), {
          storageKey: 'ok.bin',
          strict: true,
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a real pg_restore error', async () => {
      restoreScript = exitWith(1, 'pg_restore: error: permission denied\n');
      await expect(
        restoreBackupStandalone(configFor(false), {
          storageKey: 'ok.bin',
          strict: true,
        }),
      ).rejects.toThrow(/permission denied/i);
    });

    it('rejects an error the lenient mode would swallow', async () => {
      const output =
        'pg_restore: error: could not execute query: ERROR:  relation "orders" does not exist\npg_restore: warning: errors ignored on restore: 1\n';
      restoreScript = exitWith(1, output);
      await expect(
        restoreBackupStandalone(configFor(false), { storageKey: 'ok.bin' }),
      ).resolves.toBeUndefined();
      await expect(
        restoreBackupStandalone(configFor(false), {
          storageKey: 'ok.bin',
          strict: true,
        }),
      ).rejects.toThrow(/orders/);
    });

    it('reports a silent non-zero exit by its code', async () => {
      restoreScript = exitWith(2, '');
      await expect(
        restoreBackupStandalone(configFor(false), {
          storageKey: 'ok.bin',
          strict: true,
        }),
      ).rejects.toThrow('Restore exited with code 2');
    });
  });

  it('uses the real postgres engine for message classification', () => {
    expect(postgresEngine.id).toBe('postgresql');
  });
});
