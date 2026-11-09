import { existsSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { createJiti } from 'jiti';
import type { CLIConfig } from '@/cli/utils/config';
import { getDbUrlFromEnv, parseDatabaseUrl } from '@/config/env-url.helper';
import { projectDir } from '@/cloud/constants';
import type { DBDockConfig } from '@/changes/define-config';

// Looked for in this order. dbdock.config.json is the older format, read by
// loadConfig.
export const CONFIG_FILE_NAMES = [
  'dbdock.config.ts',
  'dbdock.config.mts',
  'dbdock.config.cts',
  'dbdock.config.js',
  'dbdock.config.mjs',
  'dbdock.config.cjs',
];

const KEYS = ['database', 'checkpoints', 'encryptionKey', 'enabled'];
const STORAGE_KEYS = {
  local: { required: [], optional: ['path'] },
  s3: {
    required: ['bucket', 'accessKeyId', 'secretAccessKey'],
    optional: ['region', 'endpoint'],
  },
  r2: {
    required: ['accountId', 'bucket', 'accessKeyId', 'secretAccessKey'],
    optional: [],
  },
} as const;

export interface ConfigFile {
  path: string;
  config: DBDockConfig;
}

export function findConfigFile(cwd: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const path = join(cwd, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  where: string,
): void {
  const unknown = Object.keys(value).filter((key) => !known.includes(key));
  if (unknown.length)
    throw new Error(
      `${where} has an option DBDock does not know: ${unknown.join(', ')}. Known options: ${known.join(', ')}.`,
    );
}

// Checks the shape a project wrote, so a typo fails here with the file's name
// instead of as a confusing error halfway through a change.
export function validateConfig(raw: unknown, file: string): DBDockConfig {
  const name = basename(file);
  if (!isRecord(raw))
    throw new Error(
      `${name} must export an object: export default defineConfig({ ... }).`,
    );
  unknownKeys(raw, KEYS, name);
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean')
    throw new Error(`enabled in ${name} must be true or false.`);
  if (raw.enabled === false) return { enabled: false };
  // A key that is present but empty usually means an environment variable is
  // missing here, e.g. database: process.env.DATABASE_URL in CI.
  if ('database' in raw && (typeof raw.database !== 'string' || !raw.database))
    throw new Error(
      `database in ${name} is empty. Is the environment variable it reads set here?`,
    );
  if ('encryptionKey' in raw) {
    if (typeof raw.encryptionKey !== 'string' || !raw.encryptionKey)
      throw new Error(
        `encryptionKey in ${name} is empty. Set the environment variable it reads, or remove encryptionKey to save checkpoints unencrypted.`,
      );
    if (!/^[a-f0-9]{64}$/i.test(raw.encryptionKey))
      throw new Error(
        `encryptionKey in ${name} must be 64 hexadecimal characters.`,
      );
  }
  if (raw.checkpoints !== undefined) {
    const checkpoints = raw.checkpoints;
    if (!isRecord(checkpoints) || typeof checkpoints.storage !== 'string')
      throw new Error(
        `checkpoints in ${name} needs a storage: 'local', 's3' or 'r2'.`,
      );
    const storage = checkpoints.storage as keyof typeof STORAGE_KEYS;
    const keys = STORAGE_KEYS[storage];
    if (!keys)
      throw new Error(
        `checkpoints.storage in ${name} must be 'local', 's3' or 'r2'.`,
      );
    unknownKeys(
      checkpoints,
      ['storage', ...keys.required, ...keys.optional],
      `checkpoints in ${name}`,
    );
    const missing = keys.required.filter(
      (key) => typeof checkpoints[key] !== 'string' || !checkpoints[key],
    );
    if (missing.length)
      throw new Error(
        `checkpoints in ${name} needs ${missing.join(', ')} for ${storage}. Is the environment variable it reads set here?`,
      );
  }
  return raw as DBDockConfig;
}

// Loaded fresh each time the file changes; a CLI run reads it once or twice.
const loaded = new Map<string, { mtimeMs: number; file: ConfigFile }>();

// .env is loaded first, so the file can read it through process.env.
export async function loadConfigFile(cwd: string): Promise<ConfigFile | null> {
  const path = findConfigFile(cwd);
  if (!path) return null;
  loadEnv({ path: join(cwd, '.env'), quiet: true });
  const mtimeMs = statSync(path).mtimeMs;
  const cached = loaded.get(path);
  if (cached?.mtimeMs === mtimeMs) return cached.file;
  const jiti = createJiti(__filename, {
    moduleCache: false,
    fsCache: false,
    interopDefault: true,
  });
  let raw: unknown;
  try {
    raw = await jiti.import(path, { default: true });
  } catch (error: unknown) {
    // The file runs in its own context, so its errors may not be instances of
    // this context's Error.
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : String(error);
    throw new Error(`Could not load ${basename(path)}: ${message}`);
  }
  const file = { path, config: validateConfig(raw, path) };
  loaded.set(path, { mtimeMs, file });
  return file;
}

function databaseFromUrl(url: string): CLIConfig['database'] {
  const parsed = parseDatabaseUrl(url);
  return {
    type: parsed.type,
    sslMode: parsed.sslMode,
    host: parsed.host,
    port: parsed.port,
    username: parsed.user,
    user: parsed.user,
    password: parsed.password,
    database: parsed.database,
  };
}

function storageFrom(config: DBDockConfig, cwd: string): CLIConfig['storage'] {
  const checkpoints = config.checkpoints ?? { storage: 'local' };
  switch (checkpoints.storage) {
    case 'local':
      return {
        provider: 'local',
        local: {
          path: resolve(
            cwd,
            checkpoints.path ?? join(projectDir(cwd), 'checkpoints'),
          ),
        },
      };
    case 's3':
      return {
        provider: 's3',
        s3: {
          bucket: checkpoints.bucket,
          region: checkpoints.region ?? 'us-east-1',
          endpoint: checkpoints.endpoint,
          accessKeyId: checkpoints.accessKeyId,
          secretAccessKey: checkpoints.secretAccessKey,
        },
      };
    case 'r2':
      return {
        provider: 'r2',
        r2: {
          accountId: checkpoints.accountId,
          bucket: checkpoints.bucket,
          accessKeyId: checkpoints.accessKeyId,
          secretAccessKey: checkpoints.secretAccessKey,
        },
      };
  }
}

// The settings a guarded change runs with, from a project's config file.
export function cliConfigFrom(file: ConfigFile, cwd: string): CLIConfig {
  const url = file.config.database ?? getDbUrlFromEnv();
  if (!url)
    throw new Error(
      `Set DATABASE_URL, or database in ${basename(file.path)}, before running a change.`,
    );
  const config: CLIConfig = {
    database: databaseFromUrl(url),
    storage: storageFrom(file.config, cwd),
  };
  if (file.config.encryptionKey)
    config.backup = {
      encryption: { enabled: true, key: file.config.encryptionKey },
    };
  return config;
}
