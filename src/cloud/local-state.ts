import { projectStatePath } from './constants';
import { LocalState } from './types';
import { readJsonFile, writeJsonFileAtomic } from './fs-utils';

export function defaultLocalState(projectId?: string): LocalState {
  return {
    version: 1,
    projectId,
    revision: 0,
    lastSync: null,
    stateHash: null,
    resourceHashes: {},
    pending: [],
    deadletter: [],
    cache: {},
  };
}

export function readLocalState(cwd: string = process.cwd()): LocalState {
  const existing = readJsonFile<LocalState>(projectStatePath(cwd));
  if (!existing) {
    return defaultLocalState();
  }
  return { ...defaultLocalState(existing.projectId), ...existing };
}

export function writeLocalState(
  state: LocalState,
  cwd: string = process.cwd(),
): void {
  writeJsonFileAtomic(projectStatePath(cwd), state);
}
