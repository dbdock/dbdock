export const DEFAULT_TRASH_PREFIX = '.trash/';
export const DEFAULT_ALLOWED_DELETE_PREFIXES = [
  'backups/',
  'wal/',
  'dbdock_backups/',
  'backup-',
];
export const DEFAULT_MAX_DELETES_PER_WINDOW = 1000;
export const DEFAULT_DELETION_WINDOW_MS = 60_000;
export const DEFAULT_TRASH_RETENTION_DAYS = 14;
export const MAX_STORAGE_KEY_LENGTH = 1024;

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export interface DeletionGuardPolicy {
  enabled: boolean;
  recycleBin: boolean;
  trashPrefix: string;
  allowedPrefixes: string[];
  maxDeletesPerWindow: number;
  windowMs: number;
  trashRetentionDays: number;
}

export interface DeletionGuardPolicyOverrides {
  enabled?: boolean;
  recycleBin?: boolean;
  trashRetentionDays?: number;
  maxDeletesPerWindow?: number;
  allowedPrefixes?: string[];
}

export class DeletionGuardError extends Error {
  readonly key: string;

  constructor(message: string, key: string) {
    super(message);
    this.name = 'DeletionGuardError';
    this.key = key;
  }
}

export function resolveDeletionGuardPolicy(
  overrides?: DeletionGuardPolicyOverrides,
): DeletionGuardPolicy {
  return {
    enabled: overrides?.enabled ?? true,
    recycleBin: overrides?.recycleBin ?? true,
    trashPrefix: DEFAULT_TRASH_PREFIX,
    allowedPrefixes:
      overrides?.allowedPrefixes && overrides.allowedPrefixes.length > 0
        ? overrides.allowedPrefixes
        : DEFAULT_ALLOWED_DELETE_PREFIXES,
    maxDeletesPerWindow:
      overrides?.maxDeletesPerWindow ?? DEFAULT_MAX_DELETES_PER_WINDOW,
    windowMs: DEFAULT_DELETION_WINDOW_MS,
    trashRetentionDays:
      overrides?.trashRetentionDays ?? DEFAULT_TRASH_RETENTION_DAYS,
  };
}

export function validateKeyStructure(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new DeletionGuardError(
      'Refusing to delete an empty storage key',
      key,
    );
  }

  if (key !== key.trim()) {
    throw new DeletionGuardError(
      'Refusing to delete a key with surrounding whitespace',
      key,
    );
  }

  if (key.length > MAX_STORAGE_KEY_LENGTH) {
    throw new DeletionGuardError('Refusing to delete an oversized key', key);
  }

  if (key.startsWith('/')) {
    throw new DeletionGuardError(
      'Refusing to delete a key with a leading slash',
      key,
    );
  }

  if (key.endsWith('/')) {
    throw new DeletionGuardError('Refusing to delete a folder-style key', key);
  }

  if (key.includes('..')) {
    throw new DeletionGuardError(
      'Refusing to delete a key containing a path traversal segment',
      key,
    );
  }

  if (key.includes('*') || hasControlCharacter(key)) {
    throw new DeletionGuardError(
      'Refusing to delete a key with wildcard or control characters',
      key,
    );
  }
}

export function isWithinAllowedPrefix(
  key: string,
  allowedPrefixes: string[],
): boolean {
  return allowedPrefixes.some(
    (prefix) =>
      prefix.length > 0 &&
      (key.startsWith(prefix) || key.includes(`/${prefix}`)),
  );
}

export function assertDeletableKey(
  key: string,
  allowedPrefixes: string[],
): void {
  validateKeyStructure(key);

  if (!isWithinAllowedPrefix(key, allowedPrefixes)) {
    throw new DeletionGuardError(
      `Refusing to delete a key outside protected prefixes [${allowedPrefixes.join(
        ', ',
      )}]`,
      key,
    );
  }
}

export class DeletionRateLimiter {
  private readonly events: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  record(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.events.length > 0 && this.events[0] < cutoff) {
      this.events.shift();
    }

    if (this.events.length >= this.max) {
      throw new DeletionGuardError(
        `Deletion circuit breaker tripped: more than ${this.max} deletions within ${this.windowMs}ms`,
        '',
      );
    }

    this.events.push(now);
  }
}
