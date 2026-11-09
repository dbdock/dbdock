// Finds the package.json scripts that run a migration tool and puts
// `dbdock run --` in front of the tool, so the project's own `npm run migrate`
// saves a checkpoint first. Only that text is inserted; the rest of each script
// stays exactly as written.

export const WRAP = 'dbdock run -- ';

// The migration tools DBDock recognises, and the subcommands that change the
// database. Commands that only read (prisma migrate status) are left alone.
const TOOLS: Record<string, (args: string[]) => boolean> = {
  prisma: ([group, action]) =>
    (group === 'migrate' && ['deploy', 'dev', 'reset'].includes(action)) ||
    (group === 'db' && ['push', 'execute'].includes(action)),
  'drizzle-kit': ([action]) => ['migrate', 'push'].includes(action),
  knex: ([action]) =>
    [
      'migrate:latest',
      'migrate:up',
      'migrate:down',
      'migrate:rollback',
    ].includes(action),
  sequelize: ([action]) => action?.startsWith('db:migrate') ?? false,
  'sequelize-cli': ([action]) => action?.startsWith('db:migrate') ?? false,
  typeorm: ([action]) =>
    ['migration:run', 'migration:revert', 'schema:sync'].includes(action),
  'typeorm-ts-node-commonjs': ([action]) =>
    ['migration:run', 'migration:revert', 'schema:sync'].includes(action),
  'typeorm-ts-node-esm': ([action]) =>
    ['migration:run', 'migration:revert', 'schema:sync'].includes(action),
  'node-pg-migrate': ([action]) => ['up', 'down', 'redo'].includes(action),
  'mikro-orm': ([action]) =>
    [
      'migration:up',
      'migration:down',
      'migration:fresh',
      'schema:update',
    ].includes(action),
  'db-migrate': ([action]) => ['up', 'down', 'reset'].includes(action),
};

export const KNOWN_TOOLS = Object.keys(TOOLS);

interface Token {
  text: string;
  start: number;
}

export interface ScriptChange {
  script: string;
  before: string;
  after: string;
}

export interface ScriptSkip {
  script: string;
  command: string;
  reason: string;
}

export interface ScriptPlan {
  changes: ScriptChange[];
  skipped: ScriptSkip[];
  // Scripts that already run a migration tool through DBDock.
  alreadyWrapped: string[];
}

// Splits a script into commands at &&, ||, ;, |, & and newlines outside
// quotes, keeping each command's position in the script.
function commands(script: string): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < script.length; i++) {
    const char = script[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if ('&|;\n'.includes(char)) {
      parts.push({ text: script.slice(start, i), start });
      if ((char === '&' || char === '|') && script[i + 1] === char) i++;
      start = i + 1;
    }
  }
  parts.push({ text: script.slice(start), start });
  return parts.filter((part) => part.text.trim());
}

function tokens(command: string, offset: number): Token[] {
  const found: Token[] = [];
  const pattern = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
  for (const match of command.matchAll(pattern))
    found.push({
      text: match[0].replace(/["']/g, ''),
      start: offset + (match.index ?? 0),
    });
  return found;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

type Located =
  | { kind: 'tool'; insertAt: number; tool: string }
  | { kind: 'wrapped' }
  | { kind: 'unclear'; reason: string }
  | null;

// Where the command proper starts (after environment prefixes, which must
// stay in front so DBDock sees the same environment) and which tool it runs.
function locate(list: Token[]): Located {
  let i = 0;
  while (i < list.length) {
    const text = list[i].text;
    if (ASSIGNMENT.test(text) || text === 'cross-env' || text === 'env') {
      i++;
      continue;
    }
    if (text === 'dotenv' || text === 'dotenvx') {
      const separator = list.findIndex(
        (token, index) => index > i && token.text === '--',
      );
      if (separator === -1)
        return {
          kind: 'unclear',
          reason: `DBDock can't tell where the command after ${text} starts. Put -- before it.`,
        };
      i = separator + 1;
      continue;
    }
    break;
  }
  const insertAt = i;
  const at = (index: number) => list[index]?.text;
  if (at(i) === 'dbdock' || (at(i) === 'npx' && at(i + 1) === 'dbdock'))
    return { kind: 'wrapped' };
  if (at(i) === 'npx' || at(i) === 'bunx') {
    i++;
    while (at(i)?.startsWith('-'))
      i += at(i) === '-p' || at(i) === '--package' ? 2 : 1;
  } else if (['pnpm', 'yarn', 'bun'].includes(at(i) ?? '')) {
    i++;
    if (['exec', 'dlx', 'x', 'run'].includes(at(i) ?? '')) i++;
  } else if (at(i) === 'npm' && at(i + 1) === 'exec') {
    i += 2;
    if (at(i) === '--') i++;
  }
  const tool = at(i)?.split('/').pop();
  if (!tool || !TOOLS[tool]) return null;
  const args = list
    .slice(i + 1)
    .map((token) => token.text)
    .filter((text) => !text.startsWith('-'));
  return TOOLS[tool](args) ? { kind: 'tool', insertAt, tool } : null;
}

export function planScripts(scripts: Record<string, unknown>): ScriptPlan {
  const plan: ScriptPlan = { changes: [], skipped: [], alreadyWrapped: [] };
  for (const [script, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') continue;
    const inserts: number[] = [];
    for (const command of commands(value)) {
      const found = locate(tokens(command.text, command.start));
      if (!found) continue;
      if (found.kind === 'wrapped') {
        if (!plan.alreadyWrapped.includes(script))
          plan.alreadyWrapped.push(script);
      } else if (found.kind === 'unclear') {
        plan.skipped.push({
          script,
          command: command.text.trim(),
          reason: found.reason,
        });
      } else {
        inserts.push(tokens(command.text, command.start)[found.insertAt].start);
      }
    }
    if (!inserts.length) continue;
    let after = value;
    for (const position of inserts.sort((a, b) => b - a))
      after = after.slice(0, position) + WRAP + after.slice(position);
    plan.changes.push({ script, before: value, after });
  }
  return plan;
}

// Takes DBDock back out of the scripts: the reverse of planScripts.
export function unwrapScripts(
  scripts: Record<string, unknown>,
): ScriptChange[] {
  const changes: ScriptChange[] = [];
  for (const [script, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') continue;
    const after = value.replace(/(?:npx\s+)?dbdock\s+run\s+--\s+/g, '');
    if (after !== value) changes.push({ script, before: value, after });
  }
  return changes;
}
