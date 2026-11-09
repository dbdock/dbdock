import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { projectInitCommand } from './project-init';

jest.mock('inquirer', () => ({ prompt: jest.fn() }));

describe('dbdock init', () => {
  let cwd: string;
  let output: string[];
  const savedEnv = { ...process.env };
  const savedTTY = process.stdin.isTTY;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dbdock-init-'));
    output = [];
    process.env = { ...savedEnv };
    delete process.env.DBDOCK_ENCRYPTION_SECRET;
    delete process.env.DBDOCK_PROJECT_DIR;
    process.exitCode = undefined;
    process.stdin.isTTY = false;
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    const capture = (...args: unknown[]) => output.push(args.join(' '));
    jest.spyOn(console, 'log').mockImplementation(capture);
    jest.spyOn(console, 'error').mockImplementation(capture);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    process.env = { ...savedEnv };
    process.exitCode = undefined;
    process.stdin.isTTY = savedTTY;
    await rm(cwd, { recursive: true, force: true });
  });

  const writePackage = (pkg: object, indent: string | number = 2) =>
    writeFile(
      join(cwd, 'package.json'),
      JSON.stringify(pkg, null, indent) + '\n',
    );
  const readPackage = async () =>
    JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
  const printed = () => output.join('\n');

  it('wraps the migration scripts and adds dbdock.config.ts', async () => {
    await writePackage(
      {
        name: 'shop',
        scripts: {
          'db:migrate': 'prisma migrate deploy',
          build: 'prisma generate && prisma migrate deploy && next build',
          dev: 'next dev',
        },
        devDependencies: { typescript: '^5', dbdock: '^1.4.0' },
      },
      4,
    );
    await writeFile(join(cwd, 'pnpm-lock.yaml'), '');

    await projectInitCommand({ yes: true });

    const raw = await readFile(join(cwd, 'package.json'), 'utf8');
    expect(raw).toContain('\n    "scripts"');
    expect(raw.endsWith('}\n')).toBe(true);
    expect((await readPackage()).scripts).toEqual({
      'db:migrate': 'dbdock run -- prisma migrate deploy',
      build:
        'prisma generate && dbdock run -- prisma migrate deploy && next build',
      dev: 'next dev',
    });
    const config = await readFile(join(cwd, 'dbdock.config.ts'), 'utf8');
    expect(config).toContain("import { defineConfig } from 'dbdock/config';");
    expect(config).toContain(
      '// encryptionKey: process.env.DBDOCK_ENCRYPTION_SECRET,',
    );
    expect(printed()).toContain('Next: pnpm db:migrate');
    expect(printed()).toContain('build usually runs in CI or on a host');
    expect(printed()).not.toContain('pnpm add -D dbdock');
  });

  it('turns encryption on in the config when a key is already set', async () => {
    await writePackage({ scripts: { migrate: 'knex migrate:latest' } });
    await writeFile(
      join(cwd, '.env'),
      `DBDOCK_ENCRYPTION_SECRET=${'b'.repeat(64)}\n`,
    );

    await projectInitCommand({ yes: true });

    const config = await readFile(join(cwd, 'dbdock.config.mjs'), 'utf8');
    expect(config).toContain(
      '\n  encryptionKey: process.env.DBDOCK_ENCRYPTION_SECRET,',
    );
    expect(process.env.DBDOCK_ENCRYPTION_SECRET).toBeUndefined();
    expect(printed()).toContain('npm install --save-dev dbdock');
  });

  it('adds a script when the project uses Prisma without one', async () => {
    await writePackage({ scripts: { dev: 'next dev' } });
    await writeFile(join(cwd, 'schema.prisma'), '');

    await projectInitCommand({ yes: true });

    expect((await readPackage()).scripts['db:migrate']).toBe(
      'dbdock run -- prisma migrate deploy',
    );
  });

  it('changes nothing outside a terminal without --yes', async () => {
    const pkg = { scripts: { migrate: 'drizzle-kit migrate' } };
    await writePackage(pkg);

    await projectInitCommand();

    expect(await readPackage()).toEqual(pkg);
    expect(existsSync(join(cwd, 'dbdock.config.mjs'))).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(printed()).toContain('Run again with --yes');
  });

  it('says so when the project is already set up', async () => {
    await writePackage({
      scripts: { migrate: 'dbdock run -- drizzle-kit migrate' },
    });
    await writeFile(join(cwd, 'dbdock.config.ts'), 'export default {};');

    await projectInitCommand({ yes: true });

    expect(printed()).toContain('Already set up: migrate');
  });

  it('takes DBDock back out with --remove', async () => {
    await writePackage({
      scripts: {
        migrate: 'dotenv -e .env -- dbdock run -- knex migrate:latest',
        sql: 'dbdock run --sql fix.sql',
      },
    });

    await projectInitCommand({ yes: true, remove: true });

    expect((await readPackage()).scripts).toEqual({
      migrate: 'dotenv -e .env -- knex migrate:latest',
      sql: 'dbdock run --sql fix.sql',
    });
  });

  it('needs a package.json', async () => {
    await projectInitCommand({ yes: true });

    expect(process.exitCode).toBe(1);
    expect(printed()).toContain('next to package.json');
  });
});
