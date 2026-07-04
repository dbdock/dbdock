import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  CONFLICTS_DIR,
  PROJECT_STATE_FILE,
  projectConfigPath,
  projectDir,
} from './constants';
import { ProjectConfig } from './types';
import { ensureDir, readJsonFile, writeJsonFileAtomic } from './fs-utils';

export function projectConfigExists(cwd: string = process.cwd()): boolean {
  return existsSync(projectConfigPath(cwd));
}

export function readProjectConfig(
  cwd: string = process.cwd(),
): ProjectConfig | null {
  return readJsonFile<ProjectConfig>(projectConfigPath(cwd));
}

export function writeProjectConfig(
  config: ProjectConfig,
  cwd: string = process.cwd(),
): void {
  ensureProjectDir(cwd);
  writeJsonFileAtomic(projectConfigPath(cwd), config);
}

export function ensureProjectDir(cwd: string = process.cwd()): void {
  const dir = projectDir(cwd);
  ensureDir(dir);
  const gitignorePath = join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(
      gitignorePath,
      [PROJECT_STATE_FILE, `${CONFLICTS_DIR}/`, 'credentials.json', ''].join(
        '\n',
      ),
    );
  }
}

export function newProjectConfig(
  projectId: string,
  organizationId: string | null,
  createdAt: string,
): ProjectConfig {
  return {
    projectId,
    organizationId,
    workspaceId: null,
    createdAt,
    version: 1,
    sync: { enabled: true, lastSync: null },
  };
}
