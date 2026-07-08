import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  credentialsFileMode,
  deleteToken,
  getCredential,
  getStoredToken,
  resolveToken,
  setCredential,
  setToken,
} from './credentials';

describe('cli credential store', () => {
  const account = 'https://api.example.test/api/v1';
  let dir = '';
  let prevHome: string | undefined;
  let prevToken: string | undefined;

  beforeEach(() => {
    prevHome = process.env.DBDOCK_HOME;
    prevToken = process.env.DBDOCK_TOKEN;
    delete process.env.DBDOCK_TOKEN;
    dir = mkdtempSync(join(tmpdir(), 'dbdock-cred-'));
    process.env.DBDOCK_HOME = dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.DBDOCK_HOME;
    else process.env.DBDOCK_HOME = prevHome;
    if (prevToken === undefined) delete process.env.DBDOCK_TOKEN;
    else process.env.DBDOCK_TOKEN = prevToken;
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips an oauth credential and exposes the access token', () => {
    setCredential(account, {
      type: 'oauth',
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresAt: 123,
      tokenEndpoint: 'https://x/token',
      clientId: 'c1',
    });
    expect(getCredential(account)).toMatchObject({
      type: 'oauth',
      accessToken: 'a1',
      refreshToken: 'r1',
    });
    expect(getStoredToken(account)).toBe('a1');
  });

  it('supports legacy string tokens', () => {
    setToken(account, 'static-token');
    expect(getStoredToken(account)).toBe('static-token');
    expect(getCredential(account)).toBe('static-token');
  });

  it('lets DBDOCK_TOKEN override the stored token', () => {
    setToken(account, 'stored');
    process.env.DBDOCK_TOKEN = 'env-token';
    expect(resolveToken(account)).toBe('env-token');
  });

  it('deletes a stored credential', () => {
    setToken(account, 'x');
    deleteToken(account);
    expect(getStoredToken(account)).toBeNull();
  });

  it('writes the credentials file with owner-only perms', () => {
    setToken(account, 'x');
    if (process.platform !== 'win32') {
      expect(credentialsFileMode()).toBe(0o600);
    }
  });
});
