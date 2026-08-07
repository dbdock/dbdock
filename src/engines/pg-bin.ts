import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export type PgTool = 'pg_dump' | 'pg_restore' | 'psql';

const BIN_DIR_ENV = 'DBDOCK_PG_BIN_DIR';

const TOOL_ENV: Record<PgTool, string> = {
  pg_dump: 'DBDOCK_PG_DUMP',
  pg_restore: 'DBDOCK_PG_RESTORE',
  psql: 'DBDOCK_PSQL',
};

interface PgRoot {
  dir: string;
  match(entry: string): { major: number; binDir: string } | null;
}

const SEARCH_ROOTS: PgRoot[] = [
  {
    dir: '/usr/lib/postgresql',
    match(entry) {
      const major = parseInt(entry, 10);
      return Number.isNaN(major)
        ? null
        : { major, binDir: join('/usr/lib/postgresql', entry, 'bin') };
    },
  },
  {
    dir: '/usr',
    match(entry) {
      const m = /^pgsql-(\d+)$/.exec(entry);
      return m
        ? { major: Number(m[1]), binDir: join('/usr', entry, 'bin') }
        : null;
    },
  },
  {
    dir: '/opt/homebrew/opt',
    match(entry) {
      const m = /^postgresql@(\d+)$/.exec(entry);
      return m
        ? {
            major: Number(m[1]),
            binDir: join('/opt/homebrew/opt', entry, 'bin'),
          }
        : null;
    },
  },
  {
    dir: '/usr/local/opt',
    match(entry) {
      const m = /^postgresql@(\d+)$/.exec(entry);
      return m
        ? { major: Number(m[1]), binDir: join('/usr/local/opt', entry, 'bin') }
        : null;
    },
  },
  {
    // EDB's macOS installer.
    dir: '/Library/PostgreSQL',
    match(entry) {
      const major = parseInt(entry, 10);
      return Number.isNaN(major)
        ? null
        : { major, binDir: join('/Library/PostgreSQL', entry, 'bin') };
    },
  },
];

function probeMajor(bin: string): number | null {
  try {
    const out = execFileSync(bin, ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString();
    const m = /(\d+)\.\d+/.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function candidatePaths(tool: PgTool): string[] {
  const paths: string[] = [];

  const dir = process.env[BIN_DIR_ENV];
  if (dir) paths.push(join(dir, tool));

  paths.push(tool);

  const versioned: { major: number; path: string }[] = [];
  for (const root of SEARCH_ROOTS) {
    if (!existsSync(root.dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(root.dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const hit = root.match(entry);
      if (!hit) continue;
      const bin = join(hit.binDir, tool);
      if (existsSync(bin)) versioned.push({ major: hit.major, path: bin });
    }
  }
  versioned.sort((a, b) => b.major - a.major);
  paths.push(...versioned.map((v) => v.path));

  return [...new Set(paths)];
}

export interface PgClientInfo {
  /** Absolute path, or the bare tool name when only PATH lookup is possible. */
  path: string;
  /** Major version reported by `--version`; null when it could not be probed. */
  major: number | null;
}

const cache = new Map<PgTool, PgClientInfo>();

/**
 * Resolves the client binary *and* reports which major version it is, so
 * callers can explain a version mismatch instead of only failing on one.
 *
 * The highest major wins: a host with both 17 and 18 installed dumps an 18
 * server correctly even when 17 comes first on PATH.
 */
export function describePgClient(tool: PgTool): PgClientInfo {
  const cached = cache.get(tool);
  if (cached) return cached;

  const explicit = process.env[TOOL_ENV[tool]];
  if (explicit) {
    const info: PgClientInfo = { path: explicit, major: probeMajor(explicit) };
    cache.set(tool, info);
    return info;
  }

  let best: PgClientInfo = { path: tool, major: null };
  for (const path of candidatePaths(tool)) {
    const major = probeMajor(path);
    if (major !== null && (best.major === null || major > best.major)) {
      best = { path, major };
    }
  }

  cache.set(tool, best);
  return best;
}

export function resolvePgBin(tool: PgTool): string {
  return describePgClient(tool).path;
}
