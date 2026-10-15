import { createHash } from 'crypto';
import { Client } from 'pg';
import type { ConnectionOptions as TlsOptions } from 'tls';
import type { RowDataPacket, SslOptions } from 'mysql2/promise';
import type { CLIConfig, SslMode } from '../cli/utils/config';

type DbConnection = CLIConfig['database'];

export interface DatabaseLock {
  // Drops every object a restore will recreate, so the restored database
  // matches the backup exactly instead of keeping objects created after it.
  reset(): Promise<void>;
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
    async reset() {
      if (closed)
        throw new Error('This database lock has already been released.');
      if (lostConnection) {
        throw new Error(
          `Lost the connection that holds the restore lock: ${lostConnection.message}`,
        );
      }
      await resetPostgres(client);
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

// Schemas this role may drop, minus system and extension-owned ones. pg_dump
// captures everything this role can read, so the restore recreates them.
const DROPPABLE_SCHEMAS_SQL = `
  SELECT n.nspname AS name, format('DROP SCHEMA %I CASCADE', n.nspname) AS stmt
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

// pg_dump never re-creates "public" and restores run with --no-acl, so its
// owner and grants have to be carried across the drop by hand.
const PUBLIC_SCHEMA_GRANTS_SQL = `
  SELECT format(
    'GRANT %s ON SCHEMA public TO %s%s',
    a.privilege_type,
    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END,
    CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
  ) AS stmt
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(n.nspacl) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE n.nspname = 'public' AND a.grantee <> n.nspowner`;

const PUBLIC_SCHEMA_OWNER_SQL = `
  SELECT format('ALTER SCHEMA public OWNER TO %I', r.rolname) AS stmt
  FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
  WHERE n.nspname = 'public'`;

async function resetPostgres(client: Client): Promise<void> {
  await client.query('BEGIN');
  try {
    const drops = await client.query<{ name: string; stmt: string }>(
      DROPPABLE_SCHEMAS_SQL,
    );
    const dropsPublic = drops.rows.some((row) => row.name === 'public');
    const grants = dropsPublic
      ? (await client.query<{ stmt: string }>(PUBLIC_SCHEMA_GRANTS_SQL)).rows
      : [];
    const owner = dropsPublic
      ? (await client.query<{ stmt: string }>(PUBLIC_SCHEMA_OWNER_SQL)).rows[0]
      : undefined;

    for (const { stmt } of drops.rows) await client.query(stmt);

    if (dropsPublic) {
      await client.query('CREATE SCHEMA public');
      for (const { stmt } of grants) await client.query(stmt);
      if (owner) {
        // Handing ownership back needs membership in the old owner role; if
        // this role lacks it, keep ownership rather than fail the restore.
        await client.query('SAVEPOINT dbdock_public_owner');
        try {
          await client.query(owner.stmt);
          await client.query('RELEASE SAVEPOINT dbdock_public_owner');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT dbdock_public_owner');
        }
      }
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
