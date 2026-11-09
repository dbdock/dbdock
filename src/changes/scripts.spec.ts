import { planScripts, unwrapScripts } from './scripts';

const wrap = (script: string) =>
  planScripts({ s: script }).changes[0]?.after ?? script;

describe('planScripts', () => {
  it.each([
    ['prisma migrate deploy', 'dbdock run -- prisma migrate deploy'],
    [
      'prisma generate && prisma migrate deploy && next build',
      'prisma generate && dbdock run -- prisma migrate deploy && next build',
    ],
    [
      'dotenv -e .env.production -- prisma migrate deploy',
      'dotenv -e .env.production -- dbdock run -- prisma migrate deploy',
    ],
    [
      'cross-env NODE_ENV=production knex migrate:latest',
      'cross-env NODE_ENV=production dbdock run -- knex migrate:latest',
    ],
    [
      'DATABASE_URL=$PROD_URL npx drizzle-kit migrate',
      'DATABASE_URL=$PROD_URL dbdock run -- npx drizzle-kit migrate',
    ],
    [
      'pnpm exec typeorm migration:run -d src/data-source.ts',
      'dbdock run -- pnpm exec typeorm migration:run -d src/data-source.ts',
    ],
    [
      'prisma migrate dev --name init; echo "done && more"',
      'dbdock run -- prisma migrate dev --name init; echo "done && more"',
    ],
    [
      'node-pg-migrate up && node-pg-migrate up',
      'dbdock run -- node-pg-migrate up && dbdock run -- node-pg-migrate up',
    ],
    [
      './node_modules/.bin/sequelize db:migrate',
      'dbdock run -- ./node_modules/.bin/sequelize db:migrate',
    ],
  ])('wraps %s', (before, after) => {
    expect(wrap(before)).toBe(after);
  });

  it.each([
    'prisma migrate status',
    'prisma generate',
    'drizzle-kit generate',
    'next build',
    'npm run migrate',
    'echo prisma migrate deploy',
  ])('leaves %s alone', (script) => {
    expect(planScripts({ s: script })).toEqual({
      changes: [],
      skipped: [],
      alreadyWrapped: [],
    });
  });

  it('does not wrap twice', () => {
    expect(
      planScripts({
        a: 'dbdock run -- prisma migrate deploy',
        b: 'npx dbdock run -- prisma migrate deploy',
      }),
    ).toEqual({ changes: [], skipped: [], alreadyWrapped: ['a', 'b'] });
  });

  it('skips a dotenv prefix without -- and says why', () => {
    const plan = planScripts({ m: 'dotenv -e .env prisma migrate deploy' });
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({
      script: 'm',
      command: 'dotenv -e .env prisma migrate deploy',
    });
    expect(plan.skipped[0].reason).toContain('Put -- before it');
  });

  it('ignores scripts that are not strings', () => {
    expect(planScripts({ s: 42, t: null }).changes).toEqual([]);
  });
});

describe('unwrapScripts', () => {
  it('reverses planScripts and leaves other scripts alone', () => {
    const scripts = {
      migrate: 'prisma generate && prisma migrate deploy && next build',
      envs: 'dotenv -e .env -- knex migrate:latest',
      sql: 'dbdock run --sql fix.sql',
      build: 'next build',
    };
    const wrapped = Object.fromEntries(
      Object.entries(scripts).map(([name, value]) => [name, wrap(value)]),
    );
    expect(
      Object.fromEntries(
        Object.entries(wrapped).map(([name, value]) => [
          name,
          unwrapScripts({ [name]: value })[0]?.after ?? value,
        ]),
      ),
    ).toEqual(scripts);
  });
});
