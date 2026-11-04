const VALID_DB_NAME = /^[A-Za-z0-9_$-]+$/;

export function assertValidDatabaseName(database: string): void {
  if (!VALID_DB_NAME.test(database)) {
    throw new Error(
      `Invalid database name: "${database}". Only letters, numbers, and the characters _ $ - are allowed.`,
    );
  }
}

export function assertNoOptionInjection(
  values: Array<string | undefined>,
): void {
  for (const value of values) {
    if (value !== undefined && value.startsWith('-')) {
      throw new Error(
        `Invalid connection value: "${value}". Host, user and database must not start with "-".`,
      );
    }
  }
}
