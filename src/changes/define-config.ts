// The shape of dbdock.config.ts. This file imports nothing, so a project's
// config can load `dbdock/config` without pulling in the rest of the package.

export interface LocalCheckpoints {
  storage: 'local';
  // Folder for checkpoint files, relative to the project. Default:
  // .dbdock/checkpoints.
  path?: string;
}

export interface S3Checkpoints {
  storage: 's3';
  bucket: string;
  region?: string;
  // For S3-compatible services other than AWS.
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface R2Checkpoints {
  storage: 'r2';
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface DBDockConfig {
  // Connection URL of the database DBDock checkpoints. It must be the one your
  // migrations change. Default: DATABASE_URL or DBDOCK_DB_URL.
  database?: string;
  // Where checkpoints are saved. Default: local disk, in .dbdock/checkpoints.
  checkpoints?: LocalCheckpoints | S3Checkpoints | R2Checkpoints;
  // 64 hexadecimal characters. Checkpoints are encrypted with it, and cannot
  // be restored without it. Default: DBDOCK_ENCRYPTION_SECRET.
  encryptionKey?: string;
  // false makes `dbdock run -- <command>` run the command alone, with no
  // checkpoint and no record. Default: true.
  enabled?: boolean;
}

export function defineConfig(config: DBDockConfig): DBDockConfig {
  return config;
}
