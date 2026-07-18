import {
  parseConnectionUrl,
  detectConnectionUrlFromEnv,
  detectConnectionVarsFromEnv,
  formatConnectionDisplay,
} from './init-connection';

describe('parseConnectionUrl', () => {
  it('parses a full postgres URL', () => {
    const c = parseConnectionUrl(
      'postgresql://alice:s3cr3t@db.example.com:6543/shop',
    );
    expect(c).toEqual({
      type: 'postgres',
      host: 'db.example.com',
      port: 6543,
      username: 'alice',
      password: 's3cr3t',
      database: 'shop',
    });
  });

  it('fills defaults for a bare postgres URL', () => {
    const c = parseConnectionUrl('postgres://localhost/mydb');
    expect(c.type).toBe('postgres');
    expect(c.port).toBe(5432);
    expect(c.username).toBe('postgres');
    expect(c.password).toBe('');
    expect(c.database).toBe('mydb');
  });

  it('maps mysql, redis and sqlserver schemes to engines', () => {
    expect(parseConnectionUrl('mysql://root@localhost/app').type).toBe('mysql');
    expect(parseConnectionUrl('redis://localhost:6380').type).toBe('redis');
    expect(parseConnectionUrl('redis://localhost:6380').port).toBe(6380);
    expect(parseConnectionUrl('sqlserver://sa@localhost/db').type).toBe(
      'mssql',
    );
  });

  it('decodes url-encoded credentials', () => {
    const c = parseConnectionUrl(
      'postgresql://user%40corp:p%40ss%2Fword@host/db',
    );
    expect(c.username).toBe('user@corp');
    expect(c.password).toBe('p@ss/word');
  });

  it('rejects mongodb with a migration hint', () => {
    expect(() => parseConnectionUrl('mongodb://localhost/db')).toThrow(
      /migration only/i,
    );
  });

  it('rejects unknown protocols and junk', () => {
    expect(() => parseConnectionUrl('ftp://host/db')).toThrow(
      /Unsupported connection protocol/i,
    );
    expect(() => parseConnectionUrl('not a url')).toThrow(
      /Invalid connection/i,
    );
    expect(() => parseConnectionUrl('')).toThrow(/empty/i);
  });
});

describe('detectConnectionUrlFromEnv', () => {
  it('returns the first parseable URL env var', () => {
    const d = detectConnectionUrlFromEnv({
      DATABASE_URL: 'postgresql://u@h:5432/db',
    } as NodeJS.ProcessEnv);
    expect(d?.envVar).toBe('DATABASE_URL');
    expect(d?.connection.type).toBe('postgres');
  });

  it('prefers DBDOCK_DB_URL over DATABASE_URL', () => {
    const d = detectConnectionUrlFromEnv({
      DATABASE_URL: 'postgresql://u@h/db',
      DBDOCK_DB_URL: 'redis://h:6379',
    } as NodeJS.ProcessEnv);
    expect(d?.envVar).toBe('DBDOCK_DB_URL');
    expect(d?.connection.type).toBe('redis');
  });

  it('skips unparseable env URLs and returns null when none valid', () => {
    expect(
      detectConnectionUrlFromEnv({
        DATABASE_URL: 'mongodb://h/db',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(detectConnectionUrlFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('detectConnectionVarsFromEnv', () => {
  it('collects discrete DB_* vars and coerces port', () => {
    const d = detectConnectionVarsFromEnv({
      DB_HOST: 'h',
      DB_PORT: '5555',
      DB_USER: 'bob',
      DB_NAME: 'app',
    } as NodeJS.ProcessEnv);
    expect(d).toEqual({
      host: 'h',
      port: 5555,
      username: 'bob',
      database: 'app',
    });
  });

  it('omits missing and non-numeric values', () => {
    const d = detectConnectionVarsFromEnv({
      DB_HOST: 'h',
      DB_PORT: 'nope',
    } as NodeJS.ProcessEnv);
    expect(d).toEqual({ host: 'h' });
  });
});

describe('formatConnectionDisplay', () => {
  it('masks the password when asked', () => {
    const url = formatConnectionDisplay(
      {
        type: 'postgres',
        host: 'h',
        port: 5432,
        username: 'u',
        password: 'secret',
        database: 'db',
      },
      { maskPassword: true },
    );
    expect(url).toBe('postgresql://u:****@h:5432/db');
    expect(url).not.toContain('secret');
  });
});
