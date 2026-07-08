import { getCredential, setCredential } from './credentials';
import { refreshAccessToken } from './oauth';

const EXPIRY_SKEW_MS = 60_000;

export async function getFreshAccessToken(
  account: string,
): Promise<string | null> {
  if (process.env.DBDOCK_TOKEN) {
    return process.env.DBDOCK_TOKEN;
  }

  const cred = getCredential(account);
  if (!cred) {
    return null;
  }
  if (typeof cred === 'string') {
    return cred;
  }

  const needsRefresh =
    Boolean(cred.refreshToken) &&
    cred.expiresAt !== undefined &&
    cred.expiresAt - Date.now() <= EXPIRY_SKEW_MS;

  if (!needsRefresh) {
    return cred.accessToken;
  }

  try {
    const refreshed = await refreshAccessToken(cred);
    setCredential(account, { type: 'oauth', ...refreshed });
    return refreshed.accessToken;
  } catch {
    return cred.accessToken;
  }
}
