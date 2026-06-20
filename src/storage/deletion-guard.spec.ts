import {
  DeletionGuardError,
  DeletionRateLimiter,
  assertDeletableKey,
  isWithinAllowedPrefix,
  resolveDeletionGuardPolicy,
  validateKeyStructure,
  DEFAULT_ALLOWED_DELETE_PREFIXES,
} from './deletion-guard';

describe('deletion-guard', () => {
  describe('validateKeyStructure', () => {
    it('accepts a normal backup key', () => {
      expect(() =>
        validateKeyStructure('backups/db/2026-06-19/abc_12-00-00.sql.gz'),
      ).not.toThrow();
    });

    it.each([
      ['', 'empty'],
      ['  ', 'whitespace only'],
      ['/backups/x', 'leading slash'],
      ['backups/x/', 'folder style'],
      ['backups/../secret', 'path traversal'],
      ['backups/*', 'wildcard'],
      [' backups/x', 'surrounding whitespace'],
    ])('rejects %s (%s)', (key) => {
      expect(() => validateKeyStructure(key)).toThrow(DeletionGuardError);
    });
  });

  describe('isWithinAllowedPrefix', () => {
    it('matches known roots', () => {
      expect(
        isWithinAllowedPrefix('backups/x', DEFAULT_ALLOWED_DELETE_PREFIXES),
      ).toBe(true);
      expect(
        isWithinAllowedPrefix(
          'dbdock_backups/backup-1',
          DEFAULT_ALLOWED_DELETE_PREFIXES,
        ),
      ).toBe(true);
      expect(
        isWithinAllowedPrefix('wal/db/x.br', DEFAULT_ALLOWED_DELETE_PREFIXES),
      ).toBe(true);
    });

    it('matches a tenant-prefixed managed key', () => {
      expect(
        isWithinAllowedPrefix(
          'users/123/backups/db/file.sql',
          DEFAULT_ALLOWED_DELETE_PREFIXES,
        ),
      ).toBe(true);
    });

    it('rejects foreign prefixes', () => {
      expect(
        isWithinAllowedPrefix(
          'users/123/secret',
          DEFAULT_ALLOWED_DELETE_PREFIXES,
        ),
      ).toBe(false);
      expect(
        isWithinAllowedPrefix('config.json', DEFAULT_ALLOWED_DELETE_PREFIXES),
      ).toBe(false);
    });
  });

  describe('assertDeletableKey', () => {
    it('throws for a key outside the allow-list', () => {
      expect(() => assertDeletableKey('users/123/x', ['backups/'])).toThrow(
        DeletionGuardError,
      );
    });

    it('passes for an allowed key', () => {
      expect(() =>
        assertDeletableKey('backups/db/x.sql', ['backups/']),
      ).not.toThrow();
    });
  });

  describe('DeletionRateLimiter', () => {
    it('trips the circuit breaker past the limit within the window', () => {
      const limiter = new DeletionRateLimiter(3, 1000);
      limiter.record(0);
      limiter.record(10);
      limiter.record(20);
      expect(() => limiter.record(30)).toThrow(DeletionGuardError);
    });

    it('forgets events outside the window', () => {
      const limiter = new DeletionRateLimiter(2, 1000);
      limiter.record(0);
      limiter.record(10);
      expect(() => limiter.record(2000)).not.toThrow();
    });
  });

  describe('resolveDeletionGuardPolicy', () => {
    it('defaults to enabled with a recycle bin', () => {
      const policy = resolveDeletionGuardPolicy();
      expect(policy.enabled).toBe(true);
      expect(policy.recycleBin).toBe(true);
      expect(policy.allowedPrefixes).toEqual(DEFAULT_ALLOWED_DELETE_PREFIXES);
    });

    it('honours overrides', () => {
      const policy = resolveDeletionGuardPolicy({
        recycleBin: false,
        trashRetentionDays: 30,
        allowedPrefixes: ['custom/'],
      });
      expect(policy.recycleBin).toBe(false);
      expect(policy.trashRetentionDays).toBe(30);
      expect(policy.allowedPrefixes).toEqual(['custom/']);
    });
  });
});
