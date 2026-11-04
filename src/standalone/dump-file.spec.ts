import { spawn } from 'child_process';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { postgresEngine } from '@/engines/postgres.engine';
import { createBackupStandalone } from '@/standalone/backup-standalone';
import type { CLIConfig } from '@/cli/utils/config';

describe('Checkpoint dump completion', () => {
  let directory: string;
  let config: CLIConfig;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbdock-dump-test-'));
    config = {
      database: { type: 'postgresql' },
      storage: { provider: 'local', local: { path: directory } },
    };
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('rejects a dump that closes stdout before reporting failure', async () => {
    jest.spyOn(postgresEngine, 'spawnDump').mockImplementation(() => {
      const process = spawn(global.process.execPath, [
        '-e',
        "process.stdout.end('partial dump');setTimeout(() => process.exit(2), 80)",
      ]);
      return { process, stdout: process.stdout };
    });
    await expect(createBackupStandalone(config)).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses enabled encryption without a key before starting the dump', async () => {
    const dump = jest.spyOn(postgresEngine, 'spawnDump');
    config.backup = { encryption: { enabled: true } };
    await expect(createBackupStandalone(config)).rejects.toThrow(
      'encryption requires',
    );
    expect(dump).not.toHaveBeenCalled();
  });

  it('rejects a missing dump binary and leaves no completed backup', async () => {
    jest.spyOn(postgresEngine, 'spawnDump').mockImplementation(() => {
      const process = spawn('/definitely-missing-dbdock-dump');
      return { process, stdout: process.stdout };
    });
    await expect(createBackupStandalone(config)).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});
