import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PgPassEntry {
  hostname: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

export function getPgPassPath(): string {
  if (os.platform() === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'postgresql', 'pgpass.conf');
  }
  return path.join(os.homedir(), '.pgpass');
}

export function checkPgPassPermissions(): boolean {
  if (os.platform() === 'win32') {
    return true;
  }

  const pgpassPath = getPgPassPath();

  try {
    const stats = fs.statSync(pgpassPath);
    const mode = stats.mode & 0o777;
    return mode === 0o600;
  } catch {
    return false;
  }
}

export function parsePgPassLine(line: string): PgPassEntry | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const parts: string[] = [];
  let current = '';
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === ':') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  if (parts.length !== 5) {
    return null;
  }

  return {
    hostname: parts[0],
    port: parts[1],
    database: parts[2],
    username: parts[3],
    password: parts[4],
  };
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  return value === pattern;
}

export function findPgPassEntry(
  host: string,
  port: number,
  database: string,
  user: string
): string | null {
  const pgpassPath = getPgPassPath();

  if (!fs.existsSync(pgpassPath)) {
    return null;
  }

  if (!checkPgPassPermissions()) {
    console.warn(
      `Warning: .pgpass file permissions too open. ` +
      `Run "chmod 600 ${pgpassPath}" to fix.`
    );
    return null;
  }

  try {
    const content = fs.readFileSync(pgpassPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const entry = parsePgPassLine(line);
      if (!entry) continue;

      const hostMatches = matchesPattern(host, entry.hostname);
      const portMatches = matchesPattern(String(port), entry.port);
      const dbMatches = matchesPattern(database, entry.database);
      const userMatches = matchesPattern(user, entry.username);

      if (hostMatches && portMatches && dbMatches && userMatches) {
        return entry.password;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function hasPgPassEntry(
  host: string,
  port: number,
  database: string,
  user: string
): boolean {
  return findPgPassEntry(host, port, database, user) !== null;
}

export function createPgPassEntry(
  host: string,
  port: number,
  database: string,
  user: string,
  password: string
): string {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:');

  return `${escape(host)}:${port}:${escape(database)}:${escape(user)}:${escape(password)}`;
}

export function appendToPgPass(entry: string): void {
  const pgpassPath = getPgPassPath();
  const dir = path.dirname(pgpassPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  let existingContent = '';
  if (fs.existsSync(pgpassPath)) {
    existingContent = fs.readFileSync(pgpassPath, 'utf-8');
    if (!existingContent.endsWith('\n')) {
      existingContent += '\n';
    }
  }

  fs.writeFileSync(pgpassPath, existingContent + entry + '\n', { mode: 0o600 });
}

export function getPgPassInstructions(
  host: string,
  port: number,
  database: string,
  user: string
): string {
  const pgpassPath = getPgPassPath();
  const entry = `${host}:${port}:${database}:${user}:YOUR_PASSWORD`;

  return `
To use .pgpass for secure password storage:

1. Add this line to ${pgpassPath}:
   ${entry}

2. Set proper permissions (Unix/Mac):
   chmod 600 ${pgpassPath}

3. Remove the password from your dbdock.config.json

Benefits:
- Password not exposed via PGPASSWORD environment variable
- Secure file permissions prevent unauthorized access
- Works with all PostgreSQL tools (psql, pg_dump, etc.)
`;
}
