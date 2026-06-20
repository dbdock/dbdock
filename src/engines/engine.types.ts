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

export interface DumpSpawnOptions {
  format?: string;
}

export interface DatabaseEngine {
  readonly id: string;
  readonly label: string;
  readonly defaultPort: number;
  readonly defaultUser: string;
  readonly clientToolHint: string;

  fileExtension(format?: string): string;
  spawnDump(conn: DbConnection, options: DumpSpawnOptions): DumpHandle;
  spawnRestore(conn: DbConnection): ChildProcessWithoutNullStreams;
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
