import { mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { cliConfigFrom, loadConfigFile } from './config-file';
import { guardConfig } from './config';

const KEY = 'a'.repeat(64);
const URL = 'postgresql://app:secret@db.example.com:5432/shop';

describe('dbdock.config file', () => {
  const savedEnv = { ...process.env };
  let cwd: string;

  beforeEach(async () => {
    process.env = { ...savedEnv };
    for (const name of [
      'CI',
      'DATABASE_URL',
      'DBDOCK_DB_URL',
      'DBDOCK_ENCRYPTION_SECRET',
      'DBDOCK_CHECKPOINT_DIR',
      'DBDOCK_CONFIG_PATH',
      'DBDOCK_PROJECT_DIR',
    ])
      delete process.env[name];
    cwd = await mkdtemp(join(tmpdir(), 'dbdock-config-'));
  });

  afterEach(async () => {
    process.env = { ...savedEnv };
    await rm(cwd, { recursive: true, force: true });
  });

  const write = (name: string, content: string) =>
    writeFile(join(cwd, name), content);

  // jiti runs the file outside Jest's sandbox, where this test's process.env
  // is not visible, so reading .env from the file is covered by the packed
  // package's smoke test instead. Here: .env is loaded before the file runs.
  it('loads a TypeScript config, after loading .env', async () => {
    await write('.env', 'DBDOCK_TEST_FROM_DOTENV=yes\n');
    await write(
      'dbdock.config.ts',
      `type Config = { database?: string; checkpoints?: { storage: 'local'; path?: string } };
       const config: Config = {
         database: '${URL}',
         checkpoints: { storage: 'local', path: 'snapshots' },
       };
       export default config;`,
    );

    const file = await loadConfigFile(cwd);
    expect(process.env.DBDOCK_TEST_FROM_DOTENV).toBe('yes');
    expect(file?.path).toBe(join(cwd, 'dbdock.config.ts'));
    const config = cliConfigFrom(file!, cwd);
    expect(config.database).toMatchObject({
      type: 'postgresql',
      host: 'db.example.com',
      user: 'app',
      password: 'secret',
      database: 'shop',
    });
    expect(config.storage).toEqual({
      provider: 'local',
      local: { path: join(cwd, 'snapshots') },
    });
  });

  it('loads an ES module config', async () => {
    await write(
      'dbdock.config.mjs',
      `export default { database: '${URL}', enabled: true };`,
    );
    expect((await loadConfigFile(cwd))?.config).toEqual({
      database: URL,
      enabled: true,
    });
  });

  it('prefers dbdock.config.ts over dbdock.config.json', async () => {
    await write(
      'dbdock.config.json',
      JSON.stringify({
        database: { type: 'postgres', host: 'json-host', database: 'x' },
        storage: { provider: 'local' },
      }),
    );
    await write(
      'dbdock.config.ts',
      `export default { database: '${URL}', encryptionKey: '${KEY}',
         checkpoints: { storage: 's3', bucket: 'cp', accessKeyId: 'id', secretAccessKey: 'sk' } };`,
    );

    const config = await guardConfig(cwd);

    expect(config.database.host).toBe('db.example.com');
    expect(config.storage).toMatchObject({
      provider: 's3',
      s3: { bucket: 'cp', region: 'us-east-1' },
    });
    expect(config.backup?.encryption).toEqual({ enabled: true, key: KEY });
  });

  it('reads the file again when it changes', async () => {
    const path = join(cwd, 'dbdock.config.mjs');
    await write('dbdock.config.mjs', 'export default { enabled: true };');
    expect((await loadConfigFile(cwd))?.config.enabled).toBe(true);
    await write('dbdock.config.mjs', 'export default { enabled: false };');
    const later = new Date(Date.now() + 5_000);
    await utimes(path, later, later);
    expect((await loadConfigFile(cwd))?.config.enabled).toBe(false);
  });

  it.each([
    [
      'an unknown option',
      `export default { database: '${URL}', checkpoint: { storage: 'local' } };`,
      'dbdock.config.mjs has an option DBDock does not know: checkpoint',
    ],
    [
      'a database read from a missing variable',
      'export default { database: process.env.NOT_SET_ANYWHERE };',
      'database in dbdock.config.mjs is empty',
    ],
    [
      'an encryption key read from a missing variable',
      'export default { encryptionKey: process.env.NOT_SET_ANYWHERE };',
      'encryptionKey in dbdock.config.mjs is empty',
    ],
    [
      'a short encryption key',
      "export default { encryptionKey: 'abc' };",
      'must be 64 hexadecimal characters',
    ],
    [
      'S3 without its secret',
      "export default { checkpoints: { storage: 's3', bucket: 'b', accessKeyId: 'id' } };",
      'needs secretAccessKey for s3',
    ],
    [
      'an unknown storage',
      "export default { checkpoints: { storage: 'gcs' } };",
      "must be 'local', 's3' or 'r2'",
    ],
    ['no object', 'export default 42;', 'must export an object'],
  ])('rejects %s, naming the file', async (_, content, message) => {
    await write('dbdock.config.mjs', content);
    await expect(loadConfigFile(cwd)).rejects.toThrow(message);
  });

  it('accepts enabled: false even when the rest could not be used here', async () => {
    await write(
      'dbdock.config.mjs',
      'export default { enabled: false, database: process.env.NOT_SET_ANYWHERE };',
    );
    expect((await loadConfigFile(cwd))?.config).toEqual({ enabled: false });
  });

  it('says what failed when the file itself throws', async () => {
    await write('dbdock.config.mjs', "throw new Error('boom');");
    await expect(loadConfigFile(cwd)).rejects.toThrow(
      'Could not load dbdock.config.mjs: boom',
    );
  });

  it('returns null without a config file', async () => {
    expect(await loadConfigFile(cwd)).toBeNull();
  });
});
