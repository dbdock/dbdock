import { ApiClient } from './api-client';
import { getFreshAccessToken } from './auth-token';
import { getProfile, resolveProfileName } from './global-config';

export interface Session {
  client: ApiClient;
  apiBaseUrl: string;
  account: string;
  token: string | null;
  activeOrg: string | null;
  profileName: string;
}

export async function loadSession(profileName?: string): Promise<Session> {
  const name = resolveProfileName(profileName);
  const profile = getProfile(name);
  const account = profile.apiBaseUrl;
  const token = await getFreshAccessToken(account);
  return {
    client: new ApiClient(profile.apiBaseUrl, token),
    apiBaseUrl: profile.apiBaseUrl,
    account,
    token,
    activeOrg: profile.activeOrg ?? null,
    profileName: name,
  };
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super('Not logged in. Run `dbdock login` first.');
    this.name = 'NotAuthenticatedError';
  }
}

export async function requireSession(profileName?: string): Promise<Session> {
  const session = await loadSession(profileName);
  if (!session.token) {
    throw new NotAuthenticatedError();
  }
  return session;
}
