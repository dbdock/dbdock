import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectMigration } from '@/changes/detect';

describe('Finding the migration tool', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'dbdock-detect-'));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  const pkg = (deps: Record<string, string>) =>
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ devDependencies: deps }),
    );

  it('runs prisma migrate deploy when the project has a Prisma schema', () => {
    mkdirSync(join(cwd, 'prisma'));
    writeFileSync(join(cwd, 'prisma', 'schema.prisma'), '');
    expect(detectMigration(cwd)).toEqual({
      tool: 'prisma',
      command: ['npx', 'prisma', 'migrate', 'deploy'],
      source: 'prisma/schema.prisma',
    });
  });

  it('runs drizzle-kit migrate when the project has a Drizzle config', () => {
    writeFileSync(join(cwd, 'drizzle.config.ts'), '');
    expect(detectMigration(cwd)).toEqual({
      tool: 'drizzle',
      command: ['npx', 'drizzle-kit', 'migrate'],
      source: 'drizzle.config.ts',
    });
  });

  it('falls back to package.json dependencies', () => {
    pkg({ 'drizzle-kit': '^0.31.0' });
    expect(detectMigration(cwd)?.tool).toBe('drizzle');
  });

  it('refuses to guess when both tools are present', () => {
    writeFileSync(join(cwd, 'drizzle.config.ts'), '');
    pkg({ prisma: '^6.0.0' });
    expect(() => detectMigration(cwd)).toThrow(
      'Found both Prisma (package.json) and Drizzle (drizzle.config.ts)',
    );
  });

  it('returns null when there is nothing to run', () => {
    pkg({ express: '^5.0.0' });
    expect(detectMigration(cwd)).toBeNull();
  });

  it('ignores a package.json it cannot parse', () => {
    writeFileSync(join(cwd, 'package.json'), '{ not json');
    expect(detectMigration(cwd)).toBeNull();
  });
});
