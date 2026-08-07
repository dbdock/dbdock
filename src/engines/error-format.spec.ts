import { classifyError, explainError } from './error-format';
import { postgresEngine } from './postgres.engine';

const PG_VERSION_MISMATCH = [
  'pg_dump: error: aborting because of server version mismatch',
  'pg_dump: detail: server version: 18.3 (Debian 18.3-1.pgdg12+1); pg_dump version: 17.2',
].join('\n');

const PG_PATTERNS = [
  {
    category: 'versionMismatch' as const,
    pattern: /server version mismatch|aborting because of server version/i,
  },
];

describe('version mismatch errors', () => {
  it('classifies the pg_dump server version mismatch message', () => {
    expect(classifyError(PG_VERSION_MISMATCH, PG_PATTERNS)).toBe(
      'versionMismatch',
    );
  });

  it('surfaces the parsed server and client versions in the message', () => {
    const message = postgresEngine.formatDumpError(1, [PG_VERSION_MISMATCH], {
      host: 'db.example.com',
      port: 6003,
      database: 'pdfx',
      username: 'postgres',
    } as never);

    expect(message).toContain('older than the server');
    expect(message).toContain('Server version:  18.3');
    expect(message).toContain('Client version:  17.2');
    expect(message).not.toContain('exit code');
  });

  it('names the server major in the install instructions', () => {
    const message = postgresEngine.formatDumpError(1, [PG_VERSION_MISMATCH], {
      host: 'db.example.com',
      port: 6003,
      database: 'pdfx',
      username: 'postgres',
    } as never);

    expect(message).toContain('postgresql-client-18');
    expect(message).toContain('brew install postgresql@18');
    expect(message).toContain('DBDOCK_PG_BIN_DIR=/usr/lib/postgresql/18/bin');
    expect(message).not.toContain('ships a client');
  });

  it('falls back to generic advice when the server version is unparseable', () => {
    const message = postgresEngine.formatDumpError(
      1,
      ['pg_dump: error: aborting because of server version mismatch'],
      {
        host: 'db.example.com',
        port: 6003,
        database: 'pdfx',
        username: 'postgres',
      } as never,
    );

    expect(message).toContain('older than the server');
    expect(message).toContain('DBDOCK_PG_BIN_DIR');
    expect(message).not.toContain('postgresql-client-NaN');
  });

  it('does not misclassify an ordinary auth failure as a version mismatch', () => {
    const auth = 'pg_dump: error: password authentication failed for user "x"';
    const message = postgresEngine.formatDumpError(1, [auth], {
      host: 'db.example.com',
      port: 5432,
      database: 'app',
      username: 'x',
    } as never);

    expect(message).toContain('Authentication failed');
    expect(message).not.toContain('older than the server');
  });
});

describe('explainError fallback', () => {
  it('still surfaces raw details when no pattern matches', () => {
    const message = explainError({
      raw: 'pg_dump: error: connection to server failed: some novel reason',
      patterns: PG_PATTERNS,
      ctx: {
        serverLabel: 'PostgreSQL server',
        host: 'h',
        port: '5432',
        username: 'u',
        database: 'd',
      },
      tool: 'pg_dump',
      exitCode: 1,
      mode: 'dump',
    });

    expect(message).toContain('pg_dump failed with exit code 1');
    expect(message).toContain('some novel reason');
  });
});
