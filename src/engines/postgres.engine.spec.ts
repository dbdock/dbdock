import { spawn } from 'child_process';
import { exactPattern, postgresEngine } from '@/engines/postgres.engine';

jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({ stdout: {}, stderr: {}, stdin: {} })),
}));
jest.mock('@/engines/pg-bin', () => ({
  resolvePgBin: (tool: string) => tool,
  describePgClient: () => ({ path: 'pg_dump', major: 16 }),
}));

const conn = {
  type: 'postgresql',
  host: 'db.local',
  port: 5432,
  user: 'app',
  database: 'shop',
};

const argsOf = (call: number): string[] =>
  jest.mocked(spawn).mock.calls[call][1] as string[];

describe('Postgres engine arguments', () => {
  beforeEach(() => jest.mocked(spawn).mockClear());

  it('quotes schema and extension names so pg_dump matches them exactly', () => {
    expect(exactPattern('public')).toBe('"public"');
    expect(exactPattern('Sales.2026')).toBe('"Sales.2026"');
    expect(exactPattern('say "hi"')).toBe('"say ""hi"""');
  });

  it('dumps the whole database when no scope is given', () => {
    postgresEngine.spawnDump(conn, { format: 'custom' });
    expect(argsOf(0)).not.toContain('-n');
    expect(argsOf(0)).not.toContain('-e');
  });

  it('limits the dump to the given schemas and extensions', () => {
    postgresEngine.spawnDump(conn, {
      format: 'custom',
      schemas: ['public', 'Sales'],
      extensions: ['citext'],
    });
    const args = argsOf(0);
    expect(args.slice(-6)).toEqual([
      '-n',
      '"public"',
      '-n',
      '"Sales"',
      '-e',
      '"citext"',
    ]);
  });

  it('keeps the old restore flags by default', () => {
    postgresEngine.spawnRestore(conn);
    expect(argsOf(0)).toEqual(
      expect.arrayContaining([
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
      ]),
    );
  });

  it('skips --clean and keeps grants when asked', () => {
    postgresEngine.spawnRestore(conn, { clean: false, acl: true });
    const args = argsOf(0);
    expect(args).toContain('--no-owner');
    expect(args).not.toContain('--clean');
    expect(args).not.toContain('--if-exists');
    expect(args).not.toContain('--no-acl');
  });
});
