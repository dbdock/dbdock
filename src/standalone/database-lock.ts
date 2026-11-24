import { createHash } from 'crypto';
import { Client } from 'pg';
import type { ConnectionOptions as TlsOptions } from 'tls';
import type { RowDataPacket, SslOptions } from 'mysql2/promise';
import type { CLIConfig, SslMode } from '../cli/utils/config';

type DbConnection = CLIConfig['database'];

export interface DatabaseLock {
  // Empties what a restore will recreate, so the restored database matches
  // the backup exactly instead of keeping objects created after it. Postgres
  // schemas are emptied, not dropped. With `schemas`, empties only those; a
  // schema the role may not replace makes it throw before anything changes.
  reset(schemas?: string[]): Promise<void>;
  // Postgres: every schema outside Postgres itself, and the ones this role may
  // replace. MySQL: the database itself in both.
  schemaLists(): Promise<{ existing: string[]; restorable: string[] }>;
  close(): Promise<void>;
}

export class DatabaseBusyError extends Error {
  constructor(database: string) {
    super(
      `Another restore is already running against "${database}". Wait for it to finish, then try again.`,
    );
    this.name = 'DatabaseBusyError';
  }
}

const POSTGRES_TYPES = new Set(['postgres', 'postgresql']);
const MYSQL_TYPES = new Set(['mysql', 'mariadb']);
const CONNECT_TIMEOUT_MS = 15_000;

// Advisory lock keys are scoped to the current database, so one fixed key
// serialises restores per database without colliding across databases.
const PG_LOCK_KEY = BigInt.asIntN(
  64,
  BigInt(
    `0x${createHash('sha256').update('dbdock:restore').digest('hex').slice(0, 16)}`,
  ),
).toString();

export async function lockDatabase(config: CLIConfig): Promise<DatabaseLock> {
  const conn = config.database;
  const type = (conn.type || 'postgres').toLowerCase();
  if (POSTGRES_TYPES.has(type)) return lockPostgres(conn);
  if (MYSQL_TYPES.has(type)) return lockMysql(conn);
  throw new Error(
    `Locking is not supported for "${conn.type}" databases. Supported: ${[...POSTGRES_TYPES, ...MYSQL_TYPES].join(', ')}.`,
  );
}

function postgresTls(
  sslMode: SslMode | undefined,
): false | TlsOptions | undefined {
  switch (sslMode) {
    case undefined:
      return undefined;
    case 'disable':
    case 'allow':
      return false;
    case 'prefer':
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
      return { rejectUnauthorized: true, checkServerIdentity: () => undefined };
    case 'verify-full':
      return { rejectUnauthorized: true };
  }
}

function databaseName(conn: DbConnection, fallback: string): string {
  return conn.database || fallback;
}

async function lockPostgres(conn: DbConnection): Promise<DatabaseLock> {
  const database = databaseName(conn, 'postgres');
  const client = new Client({
    host: conn.host || 'localhost',
    port: conn.port || 5432,
    user: conn.user || conn.username || 'postgres',
    password: conn.password,
    database,
    ssl: postgresTls(conn.sslMode),
    application_name: 'dbdock-restore-lock',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    keepAlive: true,
  });
  let lostConnection: Error | undefined;
  client.on('error', (err) => {
    lostConnection = err;
  });
  await client.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS locked',
      [PG_LOCK_KEY],
    );
    if (!rows[0]?.locked) throw new DatabaseBusyError(database);
  } catch (err) {
    await client.end().catch(() => undefined);
    throw err;
  }

  let closed = false;
  return {
    async reset(schemas?: string[]) {
      if (closed)
        throw new Error('This database lock has already been released.');
      if (lostConnection) {
        throw new Error(
          `Lost the connection that holds the restore lock: ${lostConnection.message}`,
        );
      }
      await resetPostgres(client, schemas);
    },
    async schemaLists() {
      return {
        existing: await listSchemas(client),
        restorable: await restorableSchemas(client),
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      await client
        .query('SELECT pg_advisory_unlock($1::bigint)', [PG_LOCK_KEY])
        .catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}

// Schemas a hosting platform owns and runs itself (Supabase's auth, storage and
// friends). DBDock never captures or drops them, even when the connecting role
// could: membership in the platform's role would otherwise let a restore wipe
// sign-ins and files the checkpoint never held.
export const MANAGED_SCHEMAS: ReadonlySet<string> = new Set([
  '_analytics',
  '_realtime',
  'auth',
  'cron',
  'extensions',
  'graphql',
  'graphql_public',
  'information_schema',
  'net',
  'pgbouncer',
  'pgsodium',
  'pgsodium_masks',
  'realtime',
  'storage',
  'supabase_functions',
  'supabase_migrations',
  'vault',
]);

export function isManagedSchema(name: string): boolean {
  return MANAGED_SCHEMAS.has(name) || name.startsWith('pg_');
}

// Schemas this role may empty, minus system and extension-owned ones.
const DROPPABLE_SCHEMAS_SQL = `
  SELECT n.nspname AS name
  FROM pg_namespace n
  WHERE n.nspname <> 'information_schema'
    AND n.nspname NOT LIKE 'pg\\_%'
    AND pg_has_role(n.nspowner, 'USAGE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_namespace'::regclass
        AND d.objid = n.oid
        AND d.deptype = 'e'
    )
  ORDER BY n.nspname`;

const ALL_SCHEMAS_SQL = `
  SELECT nspname AS name FROM pg_namespace
  WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg\\_%'
  ORDER BY nspname`;

const EXTENSIONS_IN_SCHEMAS_SQL = `
  SELECT e.extname AS name
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE n.nspname = ANY($1::text[])
  ORDER BY e.extname`;

// Every object that lives directly in a schema, named so it can be dropped.
// Left out: extensions and their members (an extension stays installed), and
// objects that are part of another one (indexes, owned sequences, row types,
// partitions), which go when their owner goes. A partitioned table depends on
// itself, so a self-reference does not count as being part of something.
const SCHEMA_OBJECTS_SQL = `
  SELECT CASE WHEN d.classid = 'pg_type'::regclass AND t.typtype = 'd'
              THEN 'domain' ELSE o.type END AS type,
         o.identity
  FROM pg_depend d
  CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, 0) o
  LEFT JOIN pg_type t ON d.classid = 'pg_type'::regclass AND t.oid = d.objid
  WHERE d.refclassid = 'pg_namespace'::regclass
    AND d.refobjid = (SELECT oid FROM pg_namespace WHERE nspname = $1)
    AND d.deptype = 'n'
    AND d.classid <> 'pg_extension'::regclass
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend e
      WHERE e.classid = d.classid AND e.objid = d.objid
        AND (e.deptype = 'e'
          OR (e.deptype IN ('i', 'a')
              AND NOT (e.refclassid = d.classid AND e.refobjid = d.objid))))`;

// The REVOKEs that clear this role's own default privileges in a schema.
// Postgres applies them to every object the role creates there, and a restore
// re-creates every object, so left in place they would add their grants on top
// of the checkpoint's. The checkpoint holds the schema's default privileges and
// puts them back after the objects, as pg_restore expects in an empty database.
const OWN_DEFAULT_PRIVILEGES_SQL = `
  SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON %s FROM %s',
           current_user, n.nspname,
           CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
                                WHEN 'f' THEN 'FUNCTIONS' ELSE 'TYPES' END,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                ELSE quote_ident(pg_get_userbyid(a.grantee)) END) AS statement
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL (SELECT DISTINCT grantee FROM aclexplode(d.defaclacl)) a
  WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    AND n.nspname = $1
    AND d.defaclobjtype IN ('r', 'S', 'f', 'T')`;

// pg_identify_object's type name, the DROP keyword, and the order to drop in:
// relations first so routines and types are no longer in use.
const DROP_KEYWORDS: Record<string, [keyword: string, order: number]> = {
  table: ['TABLE', 0],
  'foreign table': ['FOREIGN TABLE', 0],
  view: ['VIEW', 0],
  'materialized view': ['MATERIALIZED VIEW', 0],
  sequence: ['SEQUENCE', 1],
  function: ['FUNCTION', 2],
  procedure: ['PROCEDURE', 2],
  aggregate: ['AGGREGATE', 2],
  'statistics object': ['STATISTICS', 2],
  'text search configuration': ['TEXT SEARCH CONFIGURATION', 3],
  'text search dictionary': ['TEXT SEARCH DICTIONARY', 3],
  operator: ['OPERATOR', 3],
  'operator class': ['OPERATOR CLASS', 3],
  'operator family': ['OPERATOR FAMILY', 3],
  conversion: ['CONVERSION', 3],
  collation: ['COLLATION', 4],
  domain: ['DOMAIN', 4],
  type: ['TYPE', 4],
};

type Queryable = Pick<Client, 'query'>;

// Every schema that is not part of Postgres itself.
export async function listSchemas(client: Queryable): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(ALL_SCHEMAS_SQL);
  return rows.map((row) => row.name);
}

// The schemas a checkpoint may hold and a restore may replace: owned by this
// role or one it belongs to, not owned by an extension, not managed by the
// platform.
export async function restorableSchemas(client: Queryable): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(DROPPABLE_SCHEMAS_SQL);
  return rows.map((row) => row.name).filter((name) => !isManagedSchema(name));
}

// Extensions installed into these schemas. A restore keeps installed
// extensions, so the checkpoint carries their CREATE EXTENSION only to bring
// one back if the change dropped it.
export async function extensionsInSchemas(
  client: Queryable,
  schemas: string[],
): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    EXTENSIONS_IN_SCHEMAS_SQL,
    [schemas],
  );
  return rows.map((row) => row.name);
}

// Schemas in `schemas` that exist but must not be replaced. A schema that no
// longer exists is fine: the restore creates it.
export function refusedSchemas(
  schemas: string[],
  existing: string[],
  restorable: string[],
): string[] {
  return schemas.filter(
    (name) =>
      isManagedSchema(name) ||
      (existing.includes(name) && !restorable.includes(name)),
  );
}

// The DROP statements that empty a schema, in a safe order.
export function emptySchemaStatements(
  objects: { type: string; identity: string }[],
): string[] {
  const unknown = objects.filter((object) => !DROP_KEYWORDS[object.type]);
  if (unknown.length)
    throw new Error(
      `DBDock cannot empty this schema: it does not know how to remove ${unknown
        .map((object) => `${object.type} ${object.identity}`)
        .join(', ')}. Nothing was changed.`,
    );
  return [...objects]
    .sort((a, b) => DROP_KEYWORDS[a.type][1] - DROP_KEYWORDS[b.type][1])
    .map(
      (object) =>
        `DROP ${DROP_KEYWORDS[object.type][0]} IF EXISTS ${object.identity} CASCADE`,
    );
}

// Empties the schemas a restore will refill, inside one transaction. The
// schemas themselves stay: their owner, grants and other roles' default
// privileges belong to whoever set them (on Supabase, partly to
// supabase_admin, which this role cannot recreate), and installed extensions
// stay installed. This role's own default privileges there are cleared; the
// checkpoint brings them back.
export async function resetPostgres(
  client: Client,
  schemas?: string[],
): Promise<void> {
  await client.query('BEGIN');
  try {
    const existing = await listSchemas(client);
    const restorable = await restorableSchemas(client);
    if (schemas) {
      const refused = refusedSchemas(schemas, existing, restorable);
      if (refused.length)
        throw new Error(
          `DBDock may not replace ${refused.join(', ')}: the schema belongs to the platform or another role.`,
        );
    }
    const targets = schemas
      ? schemas.filter((name) => existing.includes(name))
      : restorable;
    for (const schema of targets) {
      const { rows } = await client.query<{ type: string; identity: string }>(
        SCHEMA_OBJECTS_SQL,
        [schema],
      );
      for (const statement of emptySchemaStatements(rows))
        await client.query(statement);
      const defaults = await client.query<{ statement: string }>(
        OWN_DEFAULT_PRIVILEGES_SQL,
        [schema],
      );
      for (const { statement } of defaults.rows) await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

// mysql2 checks the hostname only when verifyIdentity is set; its typings
// omit the flag even though the driver reads it.
type MysqlTlsOptions = SslOptions & { verifyIdentity?: boolean };

function mysqlTls(sslMode: SslMode | undefined): MysqlTlsOptions | undefined {
  switch (sslMode) {
    case undefined:
    case 'disable':
    case 'allow':
      return undefined;
    case 'prefer':
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
      return { rejectUnauthorized: true };
    case 'verify-full':
      return { rejectUnauthorized: true, verifyIdentity: true };
  }
}

// GET_LOCK names are server-wide and capped at 64 characters.
export function mysqlLockName(database: string): string {
  const digest = createHash('sha256').update(database).digest('hex');
  return `dbdock:restore:${digest.slice(0, 40)}`;
}

function quoteMysqlIdentifier(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

interface MysqlObject {
  kind: string;
  name: string;
}

// Views first so no view outlives the tables it reads. Matches what the dump
// recreates: mysqldump runs with --routines --triggers --events, and triggers
// go with their tables.
const MYSQL_OBJECTS_SQL = `
  SELECT 'VIEW' AS kind, TABLE_NAME AS name, 0 AS ord
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'VIEW'
  UNION ALL
  SELECT CASE WHEN TABLE_TYPE = 'SEQUENCE' THEN 'SEQUENCE' ELSE 'TABLE' END, TABLE_NAME, 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE IN ('BASE TABLE', 'SYSTEM VERSIONED', 'SEQUENCE')
  UNION ALL
  SELECT ROUTINE_TYPE, ROUTINE_NAME, 2
    FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
  UNION ALL
  SELECT 'EVENT', EVENT_NAME, 3
    FROM information_schema.EVENTS
    WHERE EVENT_SCHEMA = DATABASE()
  ORDER BY ord, name`;

export function mysqlDropStatements(objects: MysqlObject[]): string[] {
  return objects.map(
    ({ kind, name }) => `DROP ${kind} IF EXISTS ${quoteMysqlIdentifier(name)}`,
  );
}

async function lockMysql(conn: DbConnection): Promise<DatabaseLock> {
  const database = databaseName(conn, '');
  if (!database) {
    throw new Error(
      'A database name is required to lock a MySQL/MariaDB database.',
    );
  }
  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection({
    host: conn.host || 'localhost',
    port: conn.port || 3306,
    user: conn.user || conn.username || 'root',
    password: conn.password,
    database,
    ssl: mysqlTls(conn.sslMode),
    connectTimeout: CONNECT_TIMEOUT_MS,
    enableKeepAlive: true,
  });
  let lostConnection: Error | undefined;
  connection.on('error', (err: Error) => {
    lostConnection = err;
  });
  const lockName = mysqlLockName(database);
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, 0) AS locked',
      [lockName],
    );
    if (Number(rows[0]?.locked) !== 1) throw new DatabaseBusyError(database);
  } catch (err) {
    await connection.end().catch(() => undefined);
    throw err;
  }

  let closed = false;
  return {
    async reset() {
      if (closed)
        throw new Error('This database lock has already been released.');
      if (lostConnection) {
        throw new Error(
          `Lost the connection that holds the restore lock: ${lostConnection.message}`,
        );
      }
      const [objects] =
        await connection.query<RowDataPacket[]>(MYSQL_OBJECTS_SQL);
      const statements = mysqlDropStatements(
        objects.map((row) => ({
          kind: String(row.kind),
          name: String(row.name),
        })),
      );
      // MySQL DDL commits implicitly, so this cannot be one transaction; a
      // failure part-way leaves some objects dropped and is reported as-is.
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const statement of statements) await connection.query(statement);
      } finally {
        await connection
          .query('SET FOREIGN_KEY_CHECKS = 1')
          .catch(() => undefined);
      }
    },
    schemaLists() {
      return Promise.resolve({ existing: [database], restorable: [database] });
    },
    async close() {
      if (closed) return;
      closed = true;
      await connection
        .query('SELECT RELEASE_LOCK(?)', [lockName])
        .catch(() => undefined);
      await connection.end().catch(() => undefined);
    },
  };
}
