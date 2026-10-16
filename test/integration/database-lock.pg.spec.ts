import { Client } from 'pg';
import type { CLIConfig } from '../../src/cli/utils/config';
import {
  DatabaseBusyError,
  lockDatabase,
} from '../../src/standalone/database-lock';

// Needs a superuser URL, e.g. the backend's `pnpm local:db` server:
// DBDOCK_PG_TEST_URL=postgresql://dbdock:dbdock-local@127.0.0.1:54329/postgres
const adminUrl = process.env.DBDOCK_PG_TEST_URL;
const describePg = adminUrl ? describe : describe.skip;

jest.setTimeout(30_000);

const suffix = `${process.pid}`;
const DB = `dbdock_lock_test_${suffix}`;
const OWNER = `dbdock_lock_owner_${suffix}`;
const OTHER = `dbdock_lock_other_${suffix}`;
const APP = `dbdock_lock_app_${suffix}`;
const PASSWORD = 'lock-test-password';

describePg('lockDatabase on PostgreSQL', () => {
  let admin: Client;
  let ownerAdmin: Client;

  const url = new URL(adminUrl ?? 'postgresql://localhost/postgres');
  const configAs = (user: string, password: string): CLIConfig => ({
    database: {
      type: 'postgresql',
      host: url.hostname,
      port: Number(url.port || 5432),
      user,
      password,
      database: DB,
    },
    storage: { provider: 'local' },
  });
  const ownerConfig = configAs(OWNER, PASSWORD);

  // pg lets connectionString override a separate `database` option, so the
  // database has to go into the URL itself.
  const connectTo = async (database: string): Promise<Client> => {
    const target = new URL(url.toString());
    target.pathname = `/${database}`;
    const client = new Client({ connectionString: target.toString() });
    await client.connect();
    const { rows } = await client.query<{ db: string }>(
      'SELECT current_database() AS db',
    );
    if (rows[0].db !== database) {
      await client.end();
      throw new Error(`Connected to ${rows[0].db}, expected ${database}`);
    }
    return client;
  };

  beforeAll(async () => {
    admin = await connectTo('postgres');
    await admin.query(`CREATE ROLE ${OWNER} LOGIN PASSWORD '${PASSWORD}'`);
    await admin.query(`CREATE ROLE ${OTHER} NOLOGIN`);
    await admin.query(`CREATE ROLE ${APP} NOLOGIN`);
    await admin.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    ownerAdmin = await connectTo(DB);
  });

  afterAll(async () => {
    await ownerAdmin?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    for (const role of [APP, OTHER, OWNER]) {
      await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    }
    await admin?.end();
  });

  beforeEach(async () => {
    await ownerAdmin.query(`
      DROP SCHEMA IF EXISTS app CASCADE;
      DROP SCHEMA IF EXISTS vendor CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public AUTHORIZATION pg_database_owner;
      GRANT USAGE ON SCHEMA public TO PUBLIC;
      GRANT USAGE, CREATE ON SCHEMA public TO ${APP};
      CREATE TABLE public.orders (id int PRIMARY KEY);
      CREATE VIEW public.order_ids AS SELECT id FROM public.orders;
      CREATE SCHEMA app AUTHORIZATION ${OWNER};
      CREATE TABLE app.events (id int);
      CREATE SCHEMA vendor AUTHORIZATION ${OTHER};
      CREATE TABLE vendor.keep_me (id int);
    `);
  });

  it('lets only one restore hold a database at a time', async () => {
    const first = await lockDatabase(ownerConfig);
    try {
      await expect(lockDatabase(ownerConfig)).rejects.toBeInstanceOf(
        DatabaseBusyError,
      );
    } finally {
      await first.close();
    }
    const second = await lockDatabase(ownerConfig);
    await second.close();
  });

  it('wipes what the role owns and keeps what it does not', async () => {
    const lock = await lockDatabase(ownerConfig);
    try {
      await lock.reset();
    } finally {
      await lock.close();
    }
    const { rows } = await ownerAdmin.query<{ name: string }>(`
      SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'app', 'vendor') AND c.relkind IN ('r', 'v')
      ORDER BY 1`);
    expect(rows.map((r) => r.name)).toEqual(['vendor.keep_me']);
    const schemas = await ownerAdmin.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'app', 'vendor') ORDER BY 1`,
    );
    expect(schemas.rows.map((r) => r.nspname)).toEqual(['public', 'vendor']);
  });

  it('gives public back its owner and grants', async () => {
    const before = await ownerAdmin.query<{ owner: string; acl: string }>(
      `SELECT nspowner::regrole::text AS owner, nspacl::text AS acl FROM pg_namespace WHERE nspname = 'public'`,
    );
    const lock = await lockDatabase(ownerConfig);
    try {
      await lock.reset();
    } finally {
      await lock.close();
    }
    const after = await ownerAdmin.query<{ owner: string; acl: string }>(
      `SELECT nspowner::regrole::text AS owner, nspacl::text AS acl FROM pg_namespace WHERE nspname = 'public'`,
    );
    expect(after.rows[0].owner).toBe('pg_database_owner');
    const entries = (acl: string) =>
      acl
        .replace(/[{}]/g, '')
        .split(',')
        .map((entry) => entry.split('/')[0])
        .sort();
    expect(entries(after.rows[0].acl)).toEqual(entries(before.rows[0].acl));
    const app = await ownerAdmin.query<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege('${APP}', 'public', 'USAGE') AS usage,
              has_schema_privilege('${APP}', 'public', 'CREATE') AS create`,
    );
    expect(app.rows[0]).toEqual({ usage: true, create: true });
  });

  it('refuses to reset after close', async () => {
    const lock = await lockDatabase(ownerConfig);
    await lock.close();
    await expect(lock.reset()).rejects.toThrow(/already been released/);
    await lock.close();
  });
});
