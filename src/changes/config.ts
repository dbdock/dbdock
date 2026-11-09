import { resolve, join } from 'path';
import { config as loadEnv } from 'dotenv';
import { configExists, loadConfig, type CLIConfig } from '@/cli/utils/config';
import { getDbUrlFromEnv } from '@/config/env-url.helper';
import { projectDir } from '@/cloud/constants';
import { cliConfigFrom, loadConfigFile } from '@/changes/config-file';

// The settings a guarded change runs with: the ones passed in, else
// dbdock.config.ts (or .js), else dbdock.config.json, else the environment.
// .env is loaded first, so a config file can read it through process.env.
export async function guardConfig(
  cwd: string,
  supplied?: CLIConfig,
): Promise<CLIConfig> {
  if (!supplied) loadEnv({ path: join(cwd, '.env'), quiet: true });
  const file = supplied ? null : await loadConfigFile(cwd);
  if (!supplied && !file && !getDbUrlFromEnv() && !configExists(cwd))
    throw new Error(
      'Set DATABASE_URL or DBDOCK_DB_URL locally before running a change.',
    );
  const config: CLIConfig = structuredClone(
    supplied ?? (file ? cliConfigFrom(file, cwd) : loadConfig(cwd)),
  );
  if (
    !['postgres', 'postgresql', 'mysql', 'mariadb'].includes(
      config.database.type,
    )
  )
    throw new Error(
      'Guarded changes currently support PostgreSQL, MySQL and MariaDB.',
    );
  if (!['local', 's3', 'r2'].includes(config.storage.provider))
    throw new Error('Use local disk or your own S3/R2 bucket for checkpoints.');
  if (
    config.storage.provider === 'r2' &&
    !config.storage.s3 &&
    config.storage.r2
  )
    config.storage.s3 = {
      ...config.storage.r2,
      region: 'auto',
      endpoint: `https://${config.storage.r2.accountId}.r2.cloudflarestorage.com`,
    };
  if (
    config.storage.provider !== 'local' &&
    (!config.storage.s3?.bucket ||
      !config.storage.s3.accessKeyId ||
      !config.storage.s3.secretAccessKey)
  )
    throw new Error('Set your bucket and storage credentials locally.');
  if (
    !supplied &&
    !file &&
    !configExists(cwd) &&
    !process.env.STORAGE_LOCAL_PATH &&
    !process.env.DBDOCK_STORAGE_LOCAL_PATH &&
    config.storage.provider === 'local'
  )
    config.storage.local = { path: `${projectDir(cwd)}/checkpoints` };
  if (config.storage.provider === 'local')
    config.storage.local = {
      path: resolve(
        cwd,
        process.env.DBDOCK_CHECKPOINT_DIR ??
          config.storage.local?.path ??
          `${projectDir(cwd)}/checkpoints`,
      ),
    };
  if (
    process.env.CI &&
    process.env.CI !== 'false' &&
    config.storage.provider === 'local' &&
    !process.env.DBDOCK_CHECKPOINT_DIR
  )
    throw new Error(
      'CI needs your S3/R2 bucket (checkpoints in dbdock.config.ts), or DBDOCK_CHECKPOINT_DIR on a persistent volume. To run without DBDock there: enabled: !process.env.CI',
    );
  const key =
    config.backup?.encryption?.key ?? process.env.DBDOCK_ENCRYPTION_SECRET;
  if (key && !/^[a-f0-9]{64}$/i.test(key))
    throw new Error(
      'DBDOCK_ENCRYPTION_SECRET must contain 64 hexadecimal characters.',
    );
  if (config.backup?.encryption?.enabled && !key && supplied)
    throw new Error('Checkpoint encryption is enabled but its key is missing.');
  config.backup = {
    format: 'custom',
    compression: { enabled: true },
    encryption: { enabled: Boolean(key), key },
  };
  return config;
}
