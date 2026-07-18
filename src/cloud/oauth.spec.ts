import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { createHash } from 'crypto';
import { loopbackLogin, refreshAccessToken } from './oauth';

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

describe('cli oauth loopback login', () => {
  let base = '';
  let server: Server;
  let capturedChallenge = '';
  let registerCount = 0;

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', base);
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          code_challenge_methods_supported: ['S256'],
        }),
      );
      return;
    }
    if (url.pathname === '/register' && req.method === 'POST') {
      registerCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ client_id: `test-client-${registerCount}` }));
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const body = new URLSearchParams(await readBody(req));
      if (body.get('grant_type') === 'authorization_code') {
        const verifier = body.get('code_verifier') ?? '';
        const computed = b64url(createHash('sha256').update(verifier).digest());
        if (!verifier || computed !== capturedChallenge) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'mcp',
          }),
        );
        return;
      }
      if (body.get('grant_type') === 'refresh_token') {
        if (body.get('refresh_token') !== 'refresh-1') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
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
    }
    res.writeHead(404);
    res.end('not found');
  }

  beforeEach(async () => {
    capturedChallenge = '';
    registerCount = 0;
    server = createServer((req, res) => {
      void handle(req, res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  function browserOpen(code: string, stateOverride?: string) {
    return async (authorizeUrl: string): Promise<void> => {
      const u = new URL(authorizeUrl);
      capturedChallenge = u.searchParams.get('code_challenge') ?? '';
      const redirectUri = u.searchParams.get('redirect_uri') ?? '';
      const state = stateOverride ?? u.searchParams.get('state') ?? '';
      const cb = new URL(redirectUri);
      cb.searchParams.set('code', code);
      cb.searchParams.set('state', state);
      await fetch(cb.toString());
    };
  }

  it('completes the loopback flow and returns tokens (PKCE verified)', async () => {
    const tokens = await loopbackLogin({
      appBaseUrl: base,
      open: browserOpen('auth-code-xyz'),
      timeoutMs: 5000,
    });
    expect(tokens.accessToken).toBe('access-1');
    expect(tokens.refreshToken).toBe('refresh-1');
    expect(tokens.clientId).toBe('test-client-1');
    expect(tokens.tokenEndpoint).toBe(`${base}/token`);
    expect(tokens.scope).toBe('mcp');
    expect(typeof tokens.expiresAt).toBe('number');
    expect(tokens.expiresAt as number).toBeGreaterThan(Date.now());
  });

  it('shuts the loopback server down after login (no lingering socket)', async () => {
    let callbackPort = 0;
    const open = async (authorizeUrl: string): Promise<void> => {
      const u = new URL(authorizeUrl);
      capturedChallenge = u.searchParams.get('code_challenge') ?? '';
      const redirectUri = new URL(u.searchParams.get('redirect_uri') ?? '');
      callbackPort = Number(redirectUri.port);
      redirectUri.searchParams.set('code', 'auth-code');
      redirectUri.searchParams.set('state', u.searchParams.get('state') ?? '');
      await fetch(redirectUri.toString(), { keepalive: true });
    };

    await loopbackLogin({ appBaseUrl: base, open, timeoutMs: 5000 });

    await expect(
      fetch(`http://127.0.0.1:${callbackPort}/callback`),
    ).rejects.toThrow();
  });

  it('rejects on state mismatch (CSRF guard)', async () => {
    await expect(
      loopbackLogin({
        appBaseUrl: base,
        open: browserOpen('auth-code', 'WRONG-STATE'),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/state mismatch/i);
  });

  it('exchanges a refresh token for a new access token', async () => {
    const refreshed = await refreshAccessToken({
      refreshToken: 'refresh-1',
      clientId: 'test-client-1',
      tokenEndpoint: `${base}/token`,
    });
    expect(refreshed.accessToken).toBe('access-2');
    expect(refreshed.refreshToken).toBe('refresh-2');
  });
});
