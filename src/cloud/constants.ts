import { homedir } from 'os';
import { join } from 'path';

export const PROJECT_DIR_NAME = '.dbdock';
export const PROJECT_CONFIG_FILE = 'config.json';
export const PROJECT_STATE_FILE = 'state.json';
export const CONFLICTS_DIR = 'conflicts';

export const DEFAULT_PROFILE = 'default';

export function defaultApiBaseUrl(): string {
  return process.env.DBDOCK_API_URL || 'https://api.dbdock.xyz/api/v1';
}

export function defaultAppBaseUrl(): string {
  return process.env.DBDOCK_APP_URL || 'https://dbdock.xyz';
}

export function projectDir(cwd: string = process.cwd()): string {
  return process.env.DBDOCK_PROJECT_DIR || join(cwd, PROJECT_DIR_NAME);
}

export function projectConfigPath(cwd: string = process.cwd()): string {
  return join(projectDir(cwd), PROJECT_CONFIG_FILE);
}

export function projectStatePath(cwd: string = process.cwd()): string {
  return join(projectDir(cwd), PROJECT_STATE_FILE);
}

export function conflictsDir(cwd: string = process.cwd()): string {
  return join(projectDir(cwd), CONFLICTS_DIR);
}

export function globalDir(): string {
  return process.env.DBDOCK_HOME || join(homedir(), '.dbdock');
}

export function globalConfigPath(): string {
  return join(globalDir(), 'config.json');
}

export function credentialsPath(): string {
  return join(globalDir(), 'credentials.json');
}
