import { Client } from 'pg';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CLIConfig } from '../../src/cli/utils/config';
import { createBackupStandalone } from '../../src/standalone/backup-standalone';
import { restoreBackupInPlace } from '../../src/standalone/restore-in-place';

// Needs a superuser URL and pg_dump/pg_restore for the server's major version
// on PATH (or DBDOCK_PG_BIN_DIR), e.g.
// DBDOCK_PG_TEST_URL=postgresql://postgres:secret@127.0.0.1:5432/postgres
const adminUrl = process.env.DBDOCK_PG_TEST_URL;
const describePg = adminUrl ? describe : describe.skip;

jest.setTimeout(120_000);

const suffix = `${process.pid}`;
const DB = `dbdock_inplace_test_${suffix}`;
const OWNER = `dbdock_inplace_owner_${suffix}`;
const AUTH_ADMIN = `dbdock_inplace_auth_${suffix}`;
const ANON = `dbdock_inplace_anon_${suffix}`;
const PLATFORM = `dbdock_inplace_platform_${suffix}`;
const PASSWORD = 'inplace-test-password';

// The dashboard restores a whole-database backup onto the database it came
// from. The layout is Supabase's: the app's tables in public, an auth schema
// owned by a platform role, and default privileges set by both.
describePg('restoring a whole-database backup in place', () => {
  const url = new URL(adminUrl ?? 'postgresql://localhost/postgres');
  let admin: Client;
  let cwd: string;

  const config = (): CLIConfig => ({
    database: {
      type: 'postgresql',
      host: url.hostname,
      port: Number(url.port || 5432),
      user: OWNER,
      password: PASSWORD,
      database: DB,
    },
    storage: { provider: 'local', local: { path: join(cwd, 'backups') } },
    backup: {
      compression: { enabled: true, level: 6 },
      encryption: { enabled: false },
    },
  });

  const connectTo = async (database: string, user?: string) => {
    const target = new URL(url.toString());
    target.pathname = `/${database}`;
    if (user) {
      target.username = user;
      target.password = PASSWORD;
    }
    const client = new Client({ connectionString: target.toString() });
    await client.connect();
    return client;
  };

  const query = async <T extends object>(
    sql: string,
    user?: string,
  ): Promise<T[]> => {
    const client = await connectTo(DB, user);
    try {
      return (await client.query<T>(sql)).rows;
    } finally {
      await client.end();
    }
  };

  const state = async () => {
    const [row] = await query<Record<string, string | boolean | null>>(`
      SELECT (SELECT md5(string_agg(o::text, ',' ORDER BY id)) FROM orders o) AS orders,
             (SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public') AS tables,
             (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'billing') AS billing_tables,
             has_table_privilege('${ANON}', 'public.orders', 'SELECT') AS anon_orders,
             (SELECT string_agg(pg_get_userbyid(defaclrole) || ':' || defaclacl::text, ' ' ORDER BY 1)
                FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
               WHERE n.nspname = 'public') AS public_defaults`);
    return row;
  };

  const billing = async () => {
    const [row] = await query<{ invoices: string; anon_usage: boolean }>(`
      SELECT (SELECT count(*)::text FROM billing.invoices) AS invoices,
             has_schema_privilege('${ANON}', 'billing', 'USAGE') AS anon_usage`);
    return row;
  };

  const authUsers = async () =>
    (
      await query<{ n: string }>('SELECT count(*)::text AS n FROM auth.users')
    )[0].n;

  const signUp = (email: string) =>
    query(
      `INSERT INTO auth.users (id, email) SELECT max(id) + 1, '${email}' FROM auth.users`,
    );

  beforeAll(async () => {
    admin = await connectTo('postgres');
    await admin.query(`CREATE ROLE ${OWNER} LOGIN PASSWORD '${PASSWORD}'`);
    await admin.query(`CREATE ROLE ${AUTH_ADMIN} NOLOGIN`);
    await admin.query(`CREATE ROLE ${ANON} NOLOGIN`);
    await admin.query(`CREATE ROLE ${PLATFORM} NOLOGIN`);
  });

  afterAll(async () => {
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    for (const role of [PLATFORM, ANON, AUTH_ADMIN, OWNER])
      await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.end();
  });

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dbdock-inplace-'));
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    await query(`
      CREATE EXTENSION citext SCHEMA public;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${PLATFORM} IN SCHEMA public GRANT ALL ON TABLES TO ${ANON};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT SELECT ON TABLES TO ${ANON};
      CREATE SCHEMA auth AUTHORIZATION ${AUTH_ADMIN};
      CREATE TABLE auth.users (id int PRIMARY KEY, email text NOT NULL);
      ALTER TABLE auth.users OWNER TO ${AUTH_ADMIN};
      INSERT INTO auth.users VALUES (1, 'first@example.com');
      GRANT USAGE ON SCHEMA auth TO ${OWNER};
      GRANT SELECT, REFERENCES ON auth.users TO ${OWNER};`);
    await query(
      `
      CREATE TABLE profiles (id int PRIMARY KEY, user_id int REFERENCES auth.users (id), email citext);
      INSERT INTO profiles VALUES (1, 1, 'First@Example.com');
      CREATE TABLE orders (id int PRIMARY KEY, total numeric(10, 2) NOT NULL);
      INSERT INTO orders SELECT g, g * 1.5 FROM generate_series(1, 20) g;
      GRANT SELECT ON orders TO ${ANON};
      CREATE SCHEMA billing;
      GRANT USAGE ON SCHEMA billing TO ${ANON};
      CREATE TABLE billing.invoices (id int PRIMARY KEY);
      INSERT INTO billing.invoices VALUES (1), (2);`,
      OWNER,
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('puts the app schemas back, brings back a dropped one, and keeps later signups', async () => {
    const before = await state();
    const billingBefore = await billing();
    const backup = await createBackupStandalone(config());

    await query(
      `DELETE FROM orders WHERE id > 5;
       CREATE TABLE extra (id int);
       REVOKE SELECT ON orders FROM ${ANON};
       ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${ANON};
       DROP SCHEMA billing CASCADE;`,
      OWNER,
    );
    await signUp('signed-up-after-backup@example.com');

    const result = await restoreBackupInPlace(config(), {
      storageKey: backup.storageKey,
    });

    expect([...result.replaced].sort()).toEqual(['billing', 'public']);
    expect(result.kept).toEqual(['auth']);
    expect(await state()).toEqual(before);
    expect(await billing()).toEqual(billingBefore);
    expect(billingBefore).toEqual({ invoices: '2', anon_usage: true });
    expect(await authUsers()).toBe('2');
  });

  it('keeps a platform schema even when the app role owns it', async () => {
    await query(`
      ALTER SCHEMA auth OWNER TO ${OWNER};
      ALTER TABLE auth.users OWNER TO ${OWNER};`);
    const backup = await createBackupStandalone(config());
    await signUp('signed-up-after-backup@example.com');

    const result = await restoreBackupInPlace(config(), {
      storageKey: backup.storageKey,
    });

    expect(result.kept).toContain('auth');
    expect(result.replaced).not.toContain('auth');
    expect(await authUsers()).toBe('2');
  });

  it('leaves a schema created after the backup as it is', async () => {
    const backup = await createBackupStandalone(config());
    await query(
      `CREATE SCHEMA scratch;
       CREATE TABLE scratch.notes (id int);
       INSERT INTO scratch.notes VALUES (1);`,
      OWNER,
    );

    const result = await restoreBackupInPlace(config(), {
      storageKey: backup.storageKey,
    });

    expect(result.kept).toEqual(expect.arrayContaining(['auth', 'scratch']));
    const [row] = await query<{ n: string }>(
      'SELECT count(*)::text AS n FROM scratch.notes',
    );
    expect(row.n).toBe('1');
  });
});
