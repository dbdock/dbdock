import { chmodSync, existsSync, statSync } from 'fs';
import { credentialsPath, globalDir } from './constants';
import { ensureDir, readJsonFile, writeJsonFileAtomic } from './fs-utils';

// Foundation: file-backed credential store at ~/.dbdock/credentials.json (mode
// 0600), keyed by API base URL so multiple accounts/profiles can coexist.
// TODO(sync): plug in an OS-keychain provider (keytar / security / libsecret /
// wincred) behind this same interface and prefer it when available.

interface CredentialFile {
  tokens: Record<string, string>;
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

export function setToken(account: string, token: string): void {
  const file = readCredentialFile();
  file.tokens[account] = token;
  writeCredentialFile(file);
}

export function getStoredToken(account: string): string | null {
  const file = readCredentialFile();
  return file.tokens[account] ?? null;
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
