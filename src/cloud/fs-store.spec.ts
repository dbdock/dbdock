import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { newProjectConfig, readProjectConfig, writeProjectConfig } from './project-config';
import {
  credentialsFileMode,
  getStoredToken,
  resolveToken,
  setToken,
} from './credentials';
import { PROJECT_DIR_NAME } from './constants';

describe('project-config + credentials (filesystem)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dbdock-cloud-'));
    process.env.DBDOCK_HOME = join(dir, 'home');
    delete process.env.DBDOCK_PROJECT_DIR;
    delete process.env.DBDOCK_TOKEN;
  });

  it('writes then reads project config and creates .gitignore', () => {
    const cfg = newProjectConfig('proj_x', 'org_y', '2026-01-01T00:00:00.000Z');
    writeProjectConfig(cfg, dir);
    expect(readProjectConfig(dir)).toEqual(cfg);
    expect(existsSync(join(dir, PROJECT_DIR_NAME, '.gitignore'))).toBe(true);
  });

  it('stores a token at mode 0600 and roundtrips it', () => {
    setToken('https://api.example', 'dbd_secret');
    expect(getStoredToken('https://api.example')).toBe('dbd_secret');
    expect(resolveToken('https://api.example')).toBe('dbd_secret');
    if (process.platform !== 'win32') {
      expect(credentialsFileMode()).toBe(0o600);
    }
  });

  it('prefers DBDOCK_TOKEN env over the stored token', () => {
    setToken('https://api.example', 'dbd_stored');
    process.env.DBDOCK_TOKEN = 'dbd_env';
    expect(resolveToken('https://api.example')).toBe('dbd_env');
  });
});
