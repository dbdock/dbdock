import {
  DEFAULT_PROFILE,
  defaultApiBaseUrl,
  globalConfigPath,
} from './constants';
import { GlobalConfig, ProfileConfig } from './types';
import { readJsonFile, writeJsonFileAtomic } from './fs-utils';

export function defaultGlobalConfig(): GlobalConfig {
  return {
    activeProfile: DEFAULT_PROFILE,
    profiles: {
      [DEFAULT_PROFILE]: {
        apiBaseUrl: defaultApiBaseUrl(),
        activeOrg: null,
      },
    },
  };
}

export function readGlobalConfig(): GlobalConfig {
  const existing = readJsonFile<GlobalConfig>(globalConfigPath());
  if (!existing || !existing.profiles) {
    return defaultGlobalConfig();
  }
  return existing;
}

export function writeGlobalConfig(config: GlobalConfig): void {
  writeJsonFileAtomic(globalConfigPath(), config);
}

export function resolveProfileName(override?: string): string {
  return (
    override || process.env.DBDOCK_PROFILE || readGlobalConfig().activeProfile
  );
}

export function getProfile(name?: string): ProfileConfig {
  const config = readGlobalConfig();
  const profileName = resolveProfileName(name);
  return (
    config.profiles[profileName] || {
      apiBaseUrl: defaultApiBaseUrl(),
      activeOrg: null,
    }
  );
}

export function setActiveOrg(org: string | null, name?: string): void {
  const config = readGlobalConfig();
  const profileName = resolveProfileName(name);
  const profile = config.profiles[profileName] || {
    apiBaseUrl: defaultApiBaseUrl(),
    activeOrg: null,
  };
  profile.activeOrg = org;
  config.profiles[profileName] = profile;
  writeGlobalConfig(config);
}
