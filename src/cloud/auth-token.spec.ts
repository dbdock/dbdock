import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { getCredential, setCredential } from './credentials';
import { getFreshAccessToken } from './auth-token';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

describe('getFreshAccessToken', () => {
  const account = 'https://api.example.test/api/v1';
  let dir = '';
  let base = '';
  let server: Server;
  let prevHome: string | undefined;
  let prevToken: string | undefined;

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = new URLSearchParams(await readBody(req));
    if (body.get('refresh_token') === 'good') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 3600,
        }),
      );
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_grant' }));
  }

  beforeEach(async () => {
    prevHome = process.env.DBDOCK_HOME;
    prevToken = process.env.DBDOCK_TOKEN;
    delete process.env.DBDOCK_TOKEN;
    dir = mkdtempSync(join(tmpdir(), 'dbdock-auth-'));
    process.env.DBDOCK_HOME = dir;
    server = createServer((req, res) => {
      void handle(req, res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.DBDOCK_HOME;
    else process.env.DBDOCK_HOME = prevHome;
    if (prevToken === undefined) delete process.env.DBDOCK_TOKEN;
    else process.env.DBDOCK_TOKEN = prevToken;
    rmSync(dir, { recursive: true, force: true });
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('returns the stored token when it is not near expiry', async () => {
    setCredential(account, {
      type: 'oauth',
      accessToken: 'fresh',
      refreshToken: 'good',
      expiresAt: Date.now() + 3_600_000,
      tokenEndpoint: `${base}/token`,
      clientId: 'c',
    });
    expect(await getFreshAccessToken(account)).toBe('fresh');
  });

  it('refreshes an expired token and persists the new one', async () => {
    setCredential(account, {
      type: 'oauth',
      accessToken: 'old',
      refreshToken: 'good',
      expiresAt: Date.now() - 1000,
      tokenEndpoint: `${base}/token`,
      clientId: 'c',
    });
    expect(await getFreshAccessToken(account)).toBe('access-2');
    expect(getCredential(account)).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
  });

  it('falls back to the old token if refresh fails', async () => {
    setCredential(account, {
      type: 'oauth',
      accessToken: 'old',
      refreshToken: 'bad',
      expiresAt: Date.now() - 1000,
      tokenEndpoint: `${base}/token`,
      clientId: 'c',
    });
    expect(await getFreshAccessToken(account)).toBe('old');
  });

  it('lets DBDOCK_TOKEN take precedence', async () => {
    process.env.DBDOCK_TOKEN = 'env-token';
    expect(await getFreshAccessToken(account)).toBe('env-token');
  });
});
