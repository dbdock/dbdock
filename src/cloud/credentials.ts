import { chmodSync, existsSync, statSync } from 'fs';
import { credentialsPath, globalDir } from './constants';
import { ensureDir, readJsonFile, writeJsonFileAtomic } from './fs-utils';

// Foundation: file-backed credential store at ~/.dbdock/credentials.json (mode
// 0600), keyed by API base URL so multiple accounts/profiles can coexist.
// A stored credential is either a legacy static token string or an OAuth
// credential object (browser sign-in) that carries a refresh token and expiry.
// TODO(sync): plug in an OS-keychain provider (keytar / security / libsecret /
// wincred) behind this same interface and prefer it when available.

export interface OAuthCredential {
  type: 'oauth';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint: string;
  clientId: string;
  scope?: string;
}

export type StoredCredential = string | OAuthCredential;

interface CredentialFile {
  tokens: Record<string, StoredCredential>;
}

function readCredentialFile(): CredentialFile {
  const existing = readJsonFile<CredentialFile>(credentialsPath());
  if (!existing || !existing.tokens) {
    return { tokens: {} };
  }
  return existing;
}

function writeCredentialFile(file: CredentialFile): void {
  ensureDir(globalDir(), 0o700);
  writeJsonFileAtomic(credentialsPath(), file, 0o600);
  chmodSync(credentialsPath(), 0o600);
}

function accessTokenOf(cred: StoredCredential | undefined): string | null {
  if (!cred) {
    return null;
  }
  return typeof cred === 'string' ? cred : cred.accessToken;
}

export function setToken(account: string, token: string): void {
  const file = readCredentialFile();
  file.tokens[account] = token;
  writeCredentialFile(file);
}

export function setCredential(account: string, cred: OAuthCredential): void {
  const file = readCredentialFile();
  file.tokens[account] = cred;
  writeCredentialFile(file);
}

export function getCredential(account: string): StoredCredential | null {
  const file = readCredentialFile();
  return file.tokens[account] ?? null;
}

export function getStoredToken(account: string): string | null {
  return accessTokenOf(readCredentialFile().tokens[account]);
}

export function deleteToken(account: string): void {
  const file = readCredentialFile();
  if (account in file.tokens) {
    delete file.tokens[account];
    writeCredentialFile(file);
  }
}

export function resolveToken(account: string): string | null {
  if (process.env.DBDOCK_TOKEN) {
    return process.env.DBDOCK_TOKEN;
  }
  return getStoredToken(account);
}

export function credentialsFileMode(): number | null {
  const path = credentialsPath();
  if (!existsSync(path)) {
    return null;
  }
  return statSync(path).mode & 0o777;
}
