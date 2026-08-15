/**
 * Shared, engine-agnostic error formatting.
 *
 * Each engine knows its own client's error *vocabulary* (e.g. Postgres says
 * "password authentication failed", MySQL says "access denied", Redis says
 * "WRONGPASS"). It expresses that vocabulary as an ordered list of
 * {@link ErrorPattern}s mapping a regex to a normalized {@link ErrorCategory}.
 *
 * This module turns a category + connection context into a single, consistent,
 * actionable message — so `testConnection`, `formatDumpError`, and
 * `formatRestoreError` all produce the same friendly output instead of each
 * hand-rolling its own.
 */

export type ErrorCategory =
  | 'auth'
  | 'refused'
  | 'badDb'
  | 'permission'
  | 'corrupt'
  | 'versionMismatch';

export interface ErrorPattern {
  category: ErrorCategory;
  /** Matched case-insensitively against the raw client error text. */
  pattern: RegExp;
}

export interface EngineErrorContext {
  /** Human label for the server, e.g. "PostgreSQL server", "Redis server". */
  serverLabel: string;
  host: string;
  port: string;
  username: string;
  database: string;
}

export type ErrorMode = 'connect' | 'dump' | 'restore';

/** Versions parsed out of a client's version-mismatch complaint. */
export interface MismatchVersions {
  server?: string;
  client?: string;
}

/**
 * Builds the engine-specific "how to fix it" block for a version mismatch —
 * install commands only the engine can know. Omit it for the generic advice.
 */
export type VersionRemedy = (versions: MismatchVersions) => string;

export interface ExplainOptions {
  /** Raw error text from the client (stderr, ReplyError message, etc.). */
  raw: string;
  patterns: ErrorPattern[];
  ctx: EngineErrorContext;
  /** Tool/operation name used in the unclassified fallback, e.g. "pg_dump". */
  tool: string;
  exitCode?: number;
  mode?: ErrorMode;
  remedy?: VersionRemedy;
}

/** First matching pattern wins; returns undefined when nothing matches. */
export function classifyError(
  raw: string,
  patterns: ErrorPattern[],
): ErrorCategory | undefined {
  for (const { category, pattern } of patterns) {
    if (pattern.test(raw)) return category;
  }
  return undefined;
}

type DetailField = 'host' | 'port' | 'username' | 'database';

const DETAIL_LABELS: Record<DetailField, string> = {
  host: 'Host',
  port: 'Port',
  username: 'Username',
  database: 'Database',
};

/**
 * Renders the "Connection details:" block, skipping any field that is empty.
 * Restore errors have no connection context, so the block collapses to "".
 */
function detailsBlock(ctx: EngineErrorContext, fields: DetailField[]): string {
  const lines = fields
    .filter((f) => ctx[f] !== '' && ctx[f] != null)
    .map((f) => `  ${DETAIL_LABELS[f]}: ${ctx[f]}`);
  return lines.length ? `Connection details:\n${lines.join('\n')}\n\n` : '';
}

const GENERIC_VERSION_REMEDY =
  'Please:\n' +
  '  • Install client tools at or above your server major version, or\n' +
  '  • Point DBDOCK_PG_BIN_DIR at a directory containing a matching client binary';

function versionMismatchMessage(raw: string, remedy?: VersionRemedy): string {
  const server = /server version:?\s*([0-9][0-9.]*)/i.exec(raw)?.[1];
  const client =
    /(?:pg_?dump|pg_?restore|client) version:?\s*([0-9][0-9.]*)/i.exec(
      raw,
    )?.[1];
  const versions =
    server || client
      ? `  Server version:  ${server ?? 'unknown'}\n` +
        `  Client version:  ${client ?? 'unknown'}\n\n`
      : '';
  return (
    "This backup can't run because dbdock's database client is older than the server.\n\n" +
    versions +
    'A dump can only be taken by a client of the same or newer major version.\n\n' +
    (remedy?.({ server, client }) || GENERIC_VERSION_REMEDY)
  );
}

/** Turns a category + context into a complete, user-facing message. */
export function renderError(
  category: ErrorCategory,
  ctx: EngineErrorContext,
  raw = '',
  remedy?: VersionRemedy,
): string {
  switch (category) {
    case 'versionMismatch':
      return versionMismatchMessage(raw, remedy);
    case 'auth':
      return (
        (ctx.username
          ? `Authentication failed for user "${ctx.username}"`
          : 'Database authentication failed') +
        '\n\n' +
        detailsBlock(ctx, ['host', 'port', 'username', 'database']) +
        'Please verify:\n' +
        '  • Username and password are correct in dbdock.config.json\n' +
        '  • The user exists and has access to the database'
      );
    case 'refused':
      return (
        `Cannot connect to ${ctx.serverLabel}\n\n` +
        detailsBlock(ctx, ['host', 'port']) +
        'Please verify:\n' +
        '  • The server is running\n' +
        '  • Host and port are correct in dbdock.config.json\n' +
        '  • Network/firewall allows connection'
      );
    case 'badDb':
      return (
        (ctx.database
          ? `Database "${ctx.database}" does not exist or cannot be opened`
          : 'Target database does not exist or cannot be opened') +
        '\n\n' +
        detailsBlock(ctx, ['host', 'port', 'database']) +
        'Please verify:\n' +
        '  • Database name is correct in dbdock.config.json\n' +
        '  • The database exists on the server'
      );
    case 'permission':
      return (
        (ctx.username
          ? `Permission denied for user "${ctx.username}"`
          : 'Permission denied') +
        '\n\n' +
        'The user does not have sufficient privileges for this operation.\n\n' +
        'Please verify:\n' +
        '  • The user has the required read/write privileges\n' +
        '  • Consider using an account with elevated privileges'
      );
    case 'corrupt':
      return (
        'Backup file appears to be corrupted or invalid\n\n' +
        'Please:\n' +
        '  • Try a different backup file\n' +
        '  • Verify the encryption key matches if encryption is enabled'
      );
  }
}

/**
 * Renders the raw client error under a "Details:" heading, trimming each line
 * and dropping blank ones so multi-line stderr stays readable instead of
 * dumping verbatim.
 */
function detailsSection(raw: string): string {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `  ${l}`);
  return `Details:\n${lines.join('\n')}`;
}

/**
 * Classify the raw error and render a friendly message, falling back to a
 * mode-appropriate message (that still surfaces the raw details) when no
 * pattern matches.
 */
export function explainError(opts: ExplainOptions): string {
  const { raw, patterns, ctx, tool, exitCode, mode = 'dump', remedy } = opts;
  const category = classifyError(raw, patterns);
  if (category) return renderError(category, ctx, raw, remedy);

  const trimmed = raw.trim();
  const withCode = exitCode !== undefined ? ` with exit code ${exitCode}` : '';

  if (mode === 'restore') {
    return trimmed
      ? `${tool} failed.\n\n${detailsSection(trimmed)}`
      : `${tool} failed${withCode}.`;
  }
  if (mode === 'connect') {
    return trimmed
      ? `Database connection failed.\n\n${detailsSection(trimmed)}`
      : `Database connection failed${withCode}.`;
  }
  // dump
  if (trimmed) {
    return (
      `${tool} failed${withCode}.\n\n` +
      detailsSection(trimmed) +
      '\n' +
      `Connection settings:\n  Host: ${ctx.host}\n  Port: ${ctx.port}\n  Username: ${ctx.username}\n  Database: ${ctx.database}`
    );
  }
  return `${tool} failed${withCode}. Please check your database configuration.`;
}
