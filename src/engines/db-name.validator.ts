const VALID_DB_NAME = /^[A-Za-z0-9_$-]+$/;

export function assertValidDatabaseName(database: string): void {
  if (!VALID_DB_NAME.test(database)) {
    throw new Error(
      `Invalid database name: "${database}". Only letters, numbers, and the characters _ $ - are allowed.`,
    );
  }
}
