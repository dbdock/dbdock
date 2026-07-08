import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { createHash, randomBytes } from 'crypto';
import { openUrl } from './open-url';
import { defaultAppBaseUrl } from './constants';

const CLIENT_NAME = 'DBDock CLI';
const OAUTH_SCOPE = 'mcp';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint: string;
  clientId: string;
  scope?: string;
}

interface DiscoveryMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
}

export interface LoopbackLoginOptions {
  appBaseUrl?: string;
  open?: (url: string) => Promise<void>;
  onAuthorizeUrl?: (url: string) => void;
  timeoutMs?: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function resultPage(ok: boolean, error?: string): string {
  const message = ok
    ? 'You are signed in to DBDock. You can close this window and return to the terminal.'
    : `Authorization failed${error ? `: ${error}` : ''}. You can close this window and return to the terminal.`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>DBDock</title></head><body style="font-family:system-ui;padding:40px;text-align:center"><h2>DBDock CLI</h2><p>${message}</p></body></html>`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Request to ${url} failed (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

async function postForm<T>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Token request failed (HTTP ${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return JSON.parse(text) as T;
}

export async function discover(appBaseUrl: string): Promise<DiscoveryMetadata> {
  const base = appBaseUrl.replace(/\/+$/, '');
  return getJson<DiscoveryMetadata>(
    `${base}/.well-known/oauth-authorization-server`,
  );
}

async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: OAUTH_SCOPE,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Client registration failed (HTTP ${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { client_id?: string };
  if (!data.client_id) {
    throw new Error('Client registration returned no client_id');
  }
  return data.client_id;
}

interface CallbackServer {
  port: number;
  close: () => void;
  waitForResult: (timeoutMs: number) => Promise<CallbackResult>;
}

function createCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let deliver: (result: CallbackResult) => void = () => {};
    const resultPromise = new Promise<CallbackResult>((resolve) => {
      deliver = resolve;
    });

    const server: Server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const result: CallbackResult = {
          code: url.searchParams.get('code') ?? undefined,
          state: url.searchParams.get('state') ?? undefined,
          error: url.searchParams.get('error') ?? undefined,
        };
        const ok = Boolean(result.code) && !result.error;
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html' });
        res.end(resultPage(ok, result.error));
        deliver(result);
      },
    );

    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolveServer({
        port,
        close: () => server.close(),
        waitForResult: (timeoutMs: number) => {
          let timer: ReturnType<typeof setTimeout>;
          const timeout = new Promise<CallbackResult>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    'Timed out waiting for the browser sign-in to complete',
                  ),
                ),
              timeoutMs,
            );
            timer.unref();
          });
          return Promise.race([resultPromise, timeout]).finally(() =>
            clearTimeout(timer),
          );
        },
      });
    });
  });
}

export async function loopbackLogin(
  options: LoopbackLoginOptions = {},
): Promise<OAuthTokens> {
  const appBaseUrl = (options.appBaseUrl ?? defaultAppBaseUrl()).replace(
    /\/+$/,
    '',
  );
  const open = options.open ?? openUrl;
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;

  const meta = await discover(appBaseUrl);
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error('Authorization server metadata is missing endpoints');
  }
  if (!meta.registration_endpoint) {
    throw new Error(
      'Authorization server does not support dynamic client registration',
    );
  }

  const { verifier, challenge } = createPkce();
  const state = b64url(randomBytes(16));
  const cb = await createCallbackServer();

  try {
    const redirectUri = `http://127.0.0.1:${cb.port}/callback`;
    const clientId = await registerClient(
      meta.registration_endpoint,
      redirectUri,
    );

    const authorizeUrl = new URL(meta.authorization_endpoint);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', OAUTH_SCOPE);

    options.onAuthorizeUrl?.(authorizeUrl.toString());
    await open(authorizeUrl.toString()).catch(() => undefined);

    const result = await cb.waitForResult(timeoutMs);
    if (result.error || !result.code) {
      throw new Error(
        result.error
          ? `authorization error: ${result.error}`
          : 'no authorization code returned',
      );
    }
    if (result.state !== state) {
      throw new Error('state mismatch during sign-in, aborting');
    }

    const token = await postForm<TokenResponse>(meta.token_endpoint, {
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    if (!token.access_token) {
      throw new Error('token endpoint returned no access_token');
    }

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in
        ? Date.now() + token.expires_in * 1000
        : undefined,
      tokenEndpoint: meta.token_endpoint,
      clientId,
      scope: token.scope,
    };
  } finally {
    cb.close();
  }
}

export async function refreshAccessToken(cred: {
  refreshToken?: string;
  clientId: string;
  tokenEndpoint: string;
  scope?: string;
}): Promise<OAuthTokens> {
  if (!cred.refreshToken) {
    throw new Error('no refresh token available');
  }
  const token = await postForm<TokenResponse>(cred.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: cred.refreshToken,
    client_id: cred.clientId,
  });
  if (!token.access_token) {
    throw new Error('refresh returned no access_token');
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? cred.refreshToken,
    expiresAt: token.expires_in
      ? Date.now() + token.expires_in * 1000
      : undefined,
    tokenEndpoint: cred.tokenEndpoint,
    clientId: cred.clientId,
    scope: token.scope ?? cred.scope,
  };
}
