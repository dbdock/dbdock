import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { restoreBackupStandalone } from '@/standalone/restore-standalone';
import { postgresEngine } from '@/engines/postgres.engine';
import type { CLIConfig } from '@/cli/utils/config';

describe('Restore verification before database reset', () => {
  let directory: string;
  let config: CLIConfig;
  const beforeRestore = jest.fn();
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbdock-restore-test-'));
    config = {
      database: { type: 'postgresql' },
      storage: { provider: 'local', local: { path: directory } },
      backup: { compression: { enabled: true } },
    };
    beforeRestore.mockClear();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  it('rejects a damaged saved file before resetting or spawning restore', async () => {
    await writeFile(join(directory, 'backup.dump'), 'damaged dump');
    const restore = jest.spyOn(postgresEngine, 'spawnRestore');
    await expect(
      restoreBackupStandalone(config, {
        storageKey: 'backup.dump',
        checksum: 'a'.repeat(64),
        beforeRestore,
        strict: true,
      }),
    ).rejects.toThrow('damaged');
    expect(beforeRestore).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
  it('rejects invalid compressed input before resetting even if its checksum matches', async () => {
    const contents = Buffer.from('not a compressed dump');
    await writeFile(join(directory, 'backup.dump'), contents);
    const restore = jest.spyOn(postgresEngine, 'spawnRestore');
    await expect(
      restoreBackupStandalone(config, {
        storageKey: 'backup.dump',
        checksum: createHash('sha256').update(contents).digest('hex'),
        beforeRestore,
        strict: true,
      }),
    ).rejects.toThrow();
    expect(beforeRestore).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
  it('does not hide a restore failure beside a harmless version warning', async () => {
    config.backup = { compression: { enabled: false } };
    await writeFile(join(directory, 'backup.dump'), 'test dump');
    const warning =
      'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"\nCommand was: SET transaction_timeout = 0;\npg_restore: error: permission denied for table orders\npg_restore: warning: errors ignored on restore: 2\n';
    jest
      .spyOn(postgresEngine, 'spawnRestore')
      .mockImplementation(() =>
        spawn(process.execPath, [
          '-e',
          `process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write(${JSON.stringify(warning)});process.exitCode=1})`,
        ]),
      );
    await expect(
      restoreBackupStandalone(config, {
        storageKey: 'backup.dump',
        strict: true,
      }),
    ).rejects.toThrow();
  });
});
