import {
  isHarmlessPgRestoreWarning,
  summarizePgRestoreOutput,
} from './pg-restore-output';

const newerDumpIntoOlderServer = [
  'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"',
  'Command was: SET transaction_timeout = 0;',
  'pg_restore: warning: errors ignored on restore: 1',
].join('\n');

describe('isHarmlessPgRestoreWarning', () => {
  it('accepts a newer pg_dump setting an older server does not know', () => {
    expect(isHarmlessPgRestoreWarning(newerDumpIntoOlderServer)).toBe(true);
  });

  it('accepts ownership steps a non-superuser cannot run', () => {
    const output = [
      'pg_restore: while PROCESSING TOC:',
      'pg_restore: from TOC entry 3; 0 0 COMMENT EXTENSION plpgsql',
      'pg_restore: error: could not execute query: ERROR:  must be owner of extension plpgsql',
      "Command was: COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';",
      'pg_restore: error: could not execute query: ERROR:  schema "public" already exists',
      'Command was: CREATE SCHEMA public;',
      'pg_restore: warning: errors ignored on restore: 2',
    ].join('\n');
    expect(isHarmlessPgRestoreWarning(output)).toBe(true);
  });

  it('accepts the pre-12 archiver message format', () => {
    const output = [
      'pg_restore: [archiver (db)] Error while PROCESSING TOC:',
      'pg_restore: [archiver (db)] could not execute query: ERROR:  schema "public" already exists',
      'pg_restore: warning: errors ignored on restore: 1',
    ].join('\n');
    expect(isHarmlessPgRestoreWarning(output)).toBe(true);
  });

  it('rejects a real error even with no ignored-errors summary', () => {
    expect(
      isHarmlessPgRestoreWarning('pg_restore: error: permission denied\n'),
    ).toBe(false);
  });

  it('rejects a real error mixed in with harmless ones', () => {
    const output = [
      'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"',
      'pg_restore: error: could not execute query: ERROR:  relation "orders" does not exist',
      'Command was: COPY public.orders (id) FROM stdin;',
      'pg_restore: warning: errors ignored on restore: 2',
    ].join('\n');
    expect(isHarmlessPgRestoreWarning(output)).toBe(false);
  });

  it('judges the error message, not the SQL it echoes', () => {
    const output = [
      'pg_restore: error: could not execute query: ERROR:  duplicate key value violates unique constraint "users_pkey"',
      'Command was: INSERT INTO notes VALUES (\'schema "public" already exists\');',
      'pg_restore: warning: errors ignored on restore: 1',
    ].join('\n');
    expect(isHarmlessPgRestoreWarning(output)).toBe(false);
  });

  it("rejects output whose error count is short of pg_restore's tally", () => {
    const output = [
      'pg_restore: error: could not execute query: ERROR:  schema "public" already exists',
      'pg_restore: warning: errors ignored on restore: 3',
    ].join('\n');
    expect(isHarmlessPgRestoreWarning(output)).toBe(false);
  });

  it('rejects empty output, since exit 1 with nothing said is not a warning', () => {
    expect(isHarmlessPgRestoreWarning('')).toBe(false);
  });

  it('handles CRLF line endings', () => {
    expect(
      isHarmlessPgRestoreWarning(
        newerDumpIntoOlderServer.replace(/\n/g, '\r\n'),
      ),
    ).toBe(true);
  });
});

describe('summarizePgRestoreOutput', () => {
  it('separates harmful errors from harmless ones', () => {
    const summary = summarizePgRestoreOutput(
      [
        'pg_restore: error: could not execute query: ERROR:  schema "public" already exists',
        'pg_restore: error: could not execute query: ERROR:  out of shared memory',
        'pg_restore: warning: errors ignored on restore: 2',
      ].join('\n'),
    );
    expect(summary.ignoredCount).toBe(2);
    expect(summary.errors).toHaveLength(2);
    expect(summary.harmful).toEqual([
      'could not execute query: ERROR:  out of shared memory',
    ]);
  });
});
