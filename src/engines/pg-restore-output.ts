// Errors pg_restore reports and then skips without losing data: settings a
// newer pg_dump emits that an older server lacks, objects every database
// already has, and ownership/ACL steps a non-superuser is not allowed to run.
// A restore empties schemas instead of dropping them, so creating one that is
// still there, or re-applying another role's default privileges that are still
// in place (Supabase's supabase_admin), changes nothing.
const HARMLESS_ERRORS: RegExp[] = [
  /unrecognized configuration parameter "[^"]+"/i,
  /schema "[^"]+" already exists/i,
  /permission denied to change default privileges/i,
  /extension "[^"]+" already exists/i,
  /procedural language "[^"]+" already exists/i,
  /must be owner of (extension|schema|procedural language) /i,
  /role "[^"]+" does not exist/i,
];

const ERROR_LINE =
  /^pg_restore: (?:error: |\[archiver \(db\)\] could not execute query: )(.*)$/;
const IGNORED_SUMMARY =
  /^pg_restore: warning: errors ignored on restore: (\d+)/;

export interface PgRestoreOutputSummary {
  errors: string[];
  harmful: string[];
  ignoredCount: number | undefined;
}

export function summarizePgRestoreOutput(
  output: string,
): PgRestoreOutputSummary {
  const errors: string[] = [];
  let ignoredCount: number | undefined;
  for (const line of output.split(/\r?\n/)) {
    const summary = IGNORED_SUMMARY.exec(line);
    if (summary) {
      ignoredCount = Number(summary[1]);
      continue;
    }
    const error = ERROR_LINE.exec(line);
    if (error) errors.push(error[1]);
  }
  const harmful = errors.filter(
    (message) => !HARMLESS_ERRORS.some((pattern) => pattern.test(message)),
  );
  return { errors, harmful, ignoredCount };
}

// True only when pg_restore's exit 1 means "skipped some steps that don't
// matter": every reported error is a known-harmless one and the error count
// matches pg_restore's own tally, so a truncated log never reads as success.
export function isHarmlessPgRestoreWarning(output: string): boolean {
  const { errors, harmful, ignoredCount } = summarizePgRestoreOutput(output);
  if (harmful.length > 0) return false;
  if (ignoredCount === undefined) return false;
  return ignoredCount > 0 && errors.length === ignoredCount;
}
