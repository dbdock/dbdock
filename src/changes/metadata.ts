import { execFileSync } from 'child_process';
import { userInfo } from 'os';
import type { ChangeRecord, GuardOptions } from '@/changes/types';
import { RECORD_TEXT_LIMIT } from '@/changes/types';

const SQL_VERBS = [
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'INSERT',
  'UPDATE',
  'DELETE',
  'GRANT',
  'REVOKE',
] as const;
const SAFE_SUMMARIES = new Set([
  'Run migration command',
  'Run guarded command',
  'Restore checkpoint',
  'Copy database',
  'Run SQL',
]);

export function sqlSummary(sql: string): string {
  const verbs = SQL_VERBS.filter((verb) =>
    new RegExp(`\\b${verb}\\b`, 'i').test(sql),
  );
  return verbs.length ? `SQL operations: ${verbs.join(', ')}` : 'Run SQL';
}

export function safeSummary(summary?: string): string {
  if (
    summary &&
    (SAFE_SUMMARIES.has(summary) ||
      /^Schema changes: \d+ tables? added, \d+ tables? removed, \d+ columns? added, \d+ columns? removed, \d+ columns? changed$/.test(
        summary,
      ) ||
      /^SQL operations: (CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)(, (CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE))*$/.test(
        summary,
      ))
  )
    return summary;
  return 'Run guarded command';
}

export function safeLabel(value: string | undefined, fallback: string): string {
  if (
    !value ||
    value.length > RECORD_TEXT_LIMIT ||
    /[^a-zA-Z0-9 ._@/+:-]/.test(value) ||
    /:\/\/|password|secret|token[=:]/i.test(value)
  )
    return fallback;
  return value;
}

export function recordMetadata(
  options: GuardOptions,
  cwd: string,
): Pick<
  ChangeRecord,
  'actor' | 'actorKind' | 'context' | 'deploy' | 'session' | 'kind' | 'summary'
> {
  let commit: string | undefined;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    commit = undefined;
  }
  const deploy =
    options.deploy ??
    process.env.GITHUB_SHA ??
    process.env.CI_COMMIT_SHA ??
    commit;
  return {
    actor: safeLabel(
      options.actor ?? process.env.DBDOCK_ACTOR,
      options.actorKind === 'agent'
        ? 'Agent'
        : safeLabel(userInfo().username, 'Person'),
    ),
    actorKind: options.actorKind ?? 'person',
    context: process.env.CI && process.env.CI !== 'false' ? 'ci' : 'local',
    deploy: deploy && /^[a-f0-9]{7,64}$/i.test(deploy) ? deploy : null,
    session: options.session
      ? safeLabel(options.session, 'agent-session')
      : null,
    kind: options.kind ?? 'migration',
    summary: safeSummary(options.summary ?? 'Run migration command'),
  };
}
