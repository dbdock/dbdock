import { Client } from 'pg';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CLIConfig } from '../../src/cli/utils/config';
import { runGuardedChange } from '../../src/changes/guard';
import { restoreCheckpoint } from '../../src/changes/restore';
import { RestoreRefusedError, type RestorePlan } from '../../src/changes/types';

// Needs a superuser URL and pg_dump/pg_restore for the server's major version
// on PATH (or DBDOCK_PG_BIN_DIR), e.g.
// DBDOCK_PG_TEST_URL=postgresql://postgres:secret@127.0.0.1:5432/postgres
const adminUrl = process.env.DBDOCK_PG_TEST_URL;
const describePg = adminUrl ? describe : describe.skip;

jest.setTimeout(120_000);

const suffix = `${process.pid}`;
const DB = `dbdock_scope_test_${suffix}`;
const OWNER = `dbdock_scope_owner_${suffix}`;
const AUTH_ADMIN = `dbdock_scope_auth_${suffix}`;
const ANON = `dbdock_scope_anon_${suffix}`;
const PASSWORD = 'scope-test-password';

// The layout Supabase gives a project: the app's tables in public, owned by
// the role the app connects as, and an auth schema owned by a platform role.
describePg(
  'restoring a checkpoint on a database with a platform schema',
  () => {
    const url = new URL(adminUrl ?? 'postgresql://localhost/postgres');
    let admin: Client;
    let cwd: string;
    const savedEnv = { ...process.env };

    const config = (): CLIConfig => ({
      database: {
        type: 'postgresql',
        host: url.hostname,
        port: Number(url.port || 5432),
        user: OWNER,
        password: PASSWORD,
        database: DB,
      },
      storage: { provider: 'local', local: { path: join(cwd, 'checkpoints') } },
    });

    // pg lets connectionString override a separate `database` option, so the
    // database has to go into the URL itself.
    const connectTo = async (
      database: string,
      user?: string,
    ): Promise<Client> => {
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

    const withClient = async <T>(
      database: string,
      user: string | undefined,
      work: (client: Client) => Promise<T>,
    ): Promise<T> => {
      const client = await connectTo(database, user);
      try {
        return await work(client);
      } finally {
        await client.end();
      }
    };

    const appData = () =>
      withClient(DB, OWNER, async (client) => {
        const { rows } = await client.query<{ name: string; digest: string }>(`
        SELECT 'orders' AS name, md5(string_agg(o::text, ',' ORDER BY id)) AS digest FROM orders o
        UNION ALL
        SELECT 'profiles', md5(string_agg(p::text, ',' ORDER BY id)) FROM profiles p
        UNION ALL
        SELECT 'tables', string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'`);
        return Object.fromEntries(rows.map((row) => [row.name, row.digest]));
      });

    const authState = () =>
      withClient(DB, undefined, async (client) => {
        const { rows } = await client.query<{
          users: string;
          owner: string;
          oid: string;
        }>(`
        SELECT (SELECT count(*) FROM auth.users) AS users,
               pg_get_userbyid(n.nspowner) AS owner,
               n.oid::text AS oid
        FROM pg_namespace n WHERE n.nspname = 'auth'`);
        return rows[0];
      });

    const signUp = (email: string) =>
      withClient(DB, undefined, (client) =>
        client.query(
          'INSERT INTO auth.users (id, email) SELECT max(id) + 1, $1 FROM auth.users',
          [email],
        ),
      );

    const checkpointAfterBadChange = async (): Promise<string> => {
      const { record } = await runGuardedChange(
        (database) =>
          database.execute(
            'DELETE FROM orders WHERE id > 5; CREATE TABLE extra (id int);',
          ),
        { config: config(), cwd, kind: 'sql', summary: 'Run SQL' },
      );
      return record.checkpointId;
    };

    beforeAll(async () => {
      admin = await connectTo('postgres');
      await admin.query(`CREATE ROLE ${OWNER} LOGIN PASSWORD '${PASSWORD}'`);
      await admin.query(`CREATE ROLE ${AUTH_ADMIN} NOLOGIN`);
      await admin.query(`CREATE ROLE ${ANON} NOLOGIN`);
    });

    afterAll(async () => {
      await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      for (const role of [ANON, AUTH_ADMIN, OWNER])
        await admin?.query(`DROP ROLE IF EXISTS ${role}`);
      await admin?.end();
    });

    beforeEach(async () => {
      process.env = { ...savedEnv };
      delete process.env.CI;
      delete process.env.DBDOCK_ENCRYPTION_SECRET;
      delete process.env.DBDOCK_CHECKPOINT_DIR;
      cwd = await mkdtemp(join(tmpdir(), 'dbdock-scope-'));

      await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
      await admin.query(`REVOKE ${AUTH_ADMIN} FROM ${OWNER}`);
      await withClient(DB, undefined, (client) =>
        client.query(`
        ALTER SCHEMA public OWNER TO ${OWNER};
        CREATE EXTENSION citext SCHEMA public;
        CREATE SCHEMA auth AUTHORIZATION ${AUTH_ADMIN};
        CREATE TABLE auth.users (id int PRIMARY KEY, email text NOT NULL);
        ALTER TABLE auth.users OWNER TO ${AUTH_ADMIN};
        INSERT INTO auth.users VALUES (1, 'first@example.com');
        GRANT USAGE ON SCHEMA auth TO ${OWNER};
        GRANT SELECT, REFERENCES ON auth.users TO ${OWNER};`),
      );
      await withClient(DB, OWNER, (client) =>
        client.query(`
        CREATE TABLE profiles (id int PRIMARY KEY, user_id int REFERENCES auth.users (id), email citext);
        INSERT INTO profiles VALUES (1, 1, 'First@Example.com');
        CREATE TABLE orders (id int PRIMARY KEY, total numeric(10, 2) NOT NULL);
        INSERT INTO orders SELECT g, g * 1.5 FROM generate_series(1, 20) g;
        GRANT SELECT ON orders TO ${ANON};`),
      );
    });

    afterEach(async () => {
      process.env = { ...savedEnv };
      await rm(cwd, { recursive: true, force: true });
    });

    it('puts public back and leaves the platform schema and later signups alone', async () => {
      const before = await appData();
      const checkpointId = await checkpointAfterBadChange();
      await signUp('signed-up-after-checkpoint@example.com');
      const authBefore = await authState();
      const plans: RestorePlan[] = [];

      await restoreCheckpoint(checkpointId, {
        config: config(),
        cwd,
        confirmLaterWrites: true,
        onPlan: (plan) => plans.push(plan),
      });

      expect(plans).toEqual([{ replace: ['public'], keep: ['auth'] }]);
      expect(await appData()).toEqual(before);
      expect(await authState()).toEqual(authBefore);
      expect(authBefore.users).toBe('2');
      await withClient(DB, OWNER, async (client) => {
        const { rows } = await client.query<{
          matches: boolean;
          anon: boolean;
        }>(`
        SELECT (SELECT email = 'first@example.COM' FROM profiles WHERE id = 1) AS matches,
               has_table_privilege('${ANON}', 'public.orders', 'SELECT') AS anon`);
        expect(rows[0]).toEqual({ matches: true, anon: true });
      });
    });

    it('never drops the platform schema, even when the role is a member of its owner', async () => {
      await admin.query(`GRANT ${AUTH_ADMIN} TO ${OWNER}`);
      const before = await appData();
      const checkpointId = await checkpointAfterBadChange();
      await signUp('signed-up-after-checkpoint@example.com');
      const authBefore = await authState();

      await restoreCheckpoint(checkpointId, {
        config: config(),
        cwd,
        confirmLaterWrites: true,
      });

      expect(await appData()).toEqual(before);
      expect(await authState()).toEqual(authBefore);
    });

    it('puts back a schema the bad change dropped', async () => {
      await withClient(DB, OWNER, (client) =>
        client.query(
          'CREATE SCHEMA app; CREATE TABLE app.settings (k text PRIMARY KEY); INSERT INTO app.settings VALUES ($$theme$$);',
        ),
      );
      const { record } = await runGuardedChange(
        (database) => database.execute('DROP SCHEMA app CASCADE;'),
        { config: config(), cwd, kind: 'sql', summary: 'Run SQL' },
      );

      await restoreCheckpoint(record.checkpointId, {
        config: config(),
        cwd,
        confirmLaterWrites: true,
      });

      await withClient(DB, OWNER, async (client) => {
        const { rows } = await client.query<{ k: string }>(
          'SELECT k FROM app.settings',
        );
        expect(rows).toEqual([{ k: 'theme' }]);
      });
    });

    it('refuses a checkpoint saved without a schema list and changes nothing', async () => {
      const checkpointId = await checkpointAfterBadChange();
      const manifest = join(
        cwd,
        'checkpoints',
        'dbdock_checkpoints',
        `${checkpointId}.json`,
      );
      const saved = JSON.parse(await readFile(manifest, 'utf8')) as Record<
        string,
        unknown
      >;
      delete saved.schemas;
      delete saved.extensions;
      await writeFile(manifest, JSON.stringify(saved));
      const afterBadChange = await appData();

      const restore = restoreCheckpoint(checkpointId, {
        config: config(),
        cwd,
        confirmLaterWrites: true,
      });

      await expect(restore).rejects.toBeInstanceOf(RestoreRefusedError);
      await expect(restore).rejects.toMatchObject({ exitCode: 73 });
      expect(await appData()).toEqual(afterBadChange);
    });
  },
);
