import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { Readable } from 'stream';
import { CLIConfig } from '../cli/utils/config';

export type DbConnection = CLIConfig['database'];

export interface DatabaseStats {
  name: string;
  tables: number;
  size: string;
  rows: string;
}

export interface DumpHandle {
  process: ChildProcessWithoutNullStreams;
  stdout: Readable;
}

// Narrows a dump to these schemas and extensions. Empty or missing means the
// whole database. Engines without schemas ignore it.
export interface DumpScope {
  schemas?: string[];
  extensions?: string[];
}

export interface DumpSpawnOptions extends DumpScope {
  format?: string;
}

export interface RestoreSpawnOptions {
  // Drop each object before recreating it. Turn off when the target schemas
  // were already emptied: with it on, pg_restore drops and recreates public
  // itself, losing the owner and grants the reset carried across.
  clean?: boolean;
  // Restore grants and default privileges from the archive. Safe only when
  // restoring onto the server the archive came from, where the roles exist.
  acl?: boolean;
}

export interface DatabaseEngine {
  readonly id: string;
  readonly label: string;
  readonly defaultPort: number;
  readonly defaultUser: string;
  readonly clientToolHint: string;

  fileExtension(format?: string): string;
  spawnDump(conn: DbConnection, options: DumpSpawnOptions): DumpHandle;
  spawnRestore(
    conn: DbConnection,
    options?: RestoreSpawnOptions,
  ): ChildProcessWithoutNullStreams;
  testConnection(conn: DbConnection): Promise<void>;
  getStats(conn: DbConnection): Promise<DatabaseStats>;
  formatDumpError(
    exitCode: number,
    messages: string[],
    conn: DbConnection,
  ): string;
  formatRestoreError(errorOutput: string): string;
  shouldIgnoreRestoreMessage(message: string): boolean;
}
