import { CLIConfig } from '../cli/utils/config';
import { createHash } from 'crypto';
import { Readable, Transform, Writable, pipeline } from 'stream';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdtempSync,
  openSync,
  closeSync,
  readSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve, sep } from 'path';
import { createBrotliDecompress } from 'zlib';
import {
  WRONG_KEY_MESSAGE,
  createBackupDecryptStream,
  createLegacyDecryptStream,
} from '../crypto/backup-crypto';
import {
  BACKUP_HEADER_LENGTH,
  BACKUP_VERSION_GCM_FP,
  KEY_FINGERPRINT_LENGTH,
  computeKeyFingerprint,
  formatKeyFingerprint,
  hasBackupHeader,
  readBackupVersion,
} from '../crypto/backup-format';
import { S3StorageAdapter } from '../storage/adapters/s3.adapter';
import { R2StorageAdapter } from '../storage/adapters/r2.adapter';
import { CloudinaryStorageAdapter } from '../storage/adapters/cloudinary.adapter';
import { ManagedStorageAdapter } from '../storage/adapters/managed.adapter';
import { IStorageAdapter } from '../storage/storage.interface';
import { ManagedBroker } from '../cloud/types';
import { getEngine } from '../engines';
import type {
  DatabaseEngine,
  RestoreSpawnOptions,
} from '../engines/engine.types';
import {
  isHarmlessPgRestoreWarning,
  summarizePgRestoreOutput,
} from '../engines/pg-restore-output';

export interface RestoreStandaloneDeps {
  managed?: ManagedBroker;
}

export interface RestoreProgressCallback {
  onProgress?: (bytesProcessed: number) => void;
  onStage?: (stage: string) => void;
}

export interface RestoreStandaloneOptions {
  storageKey: string;
  target?: CLIConfig['database'];
  // Fail on any restore error instead of tolerating exit 1; for Postgres only
  // the pg_restore errors isHarmlessPgRestoreWarning accepts are let through.
  strict?: boolean;
  // Runs once the backup is downloaded and proven to decode, just before the
  // restore starts. Use it to clear the target, e.g. DatabaseLock.reset().
  // With selectSchemas it gets the schemas the restore will replace.
  beforeRestore?: (schemas?: string[]) => Promise<void>;
  // Postgres only. Called with the schemas the backup holds once it is proven
  // to decode. The restore then touches only the schemas in `restore`, and
  // creates the ones in `create` (in the backup but gone from the database)
  // together with their grants. Everything outside them, including objects
  // that belong to no schema such as extensions and event triggers, is left
  // as it is.
  selectSchemas?: (inBackup: string[]) => Promise<SchemaSelection>;
  checksum?: string;
  // How the engine's restore tool runs, e.g. without --clean after
  // beforeRestore has already emptied the target schemas.
  restoreFlags?: RestoreSpawnOptions;
}

export interface SchemaSelection {
  restore: string[];
  create: string[];
}

const TOC_ENTRY = /^(\d+); \d+ \d+ /;
const SCHEMA_ENTRY = /^\d+; \d+ \d+ SCHEMA - (\S+)/;
const SCHEMA_DETAIL =
  /^\d+; \d+ \d+ (?:ACL|COMMENT|SECURITY LABEL) - SCHEMA (\S+)/;

// The schemas a pg_restore -l listing holds. public has no SCHEMA entry since
// PostgreSQL 15, so it is always included.
export function archiveSchemas(contents: string[]): string[] {
  const names = new Set(['public']);
  for (const line of contents) {
    const match = SCHEMA_ENTRY.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names];
}

// The lines of a full listing to restore, in archive order: the entries
// pg_restore itself picked for the chosen schemas (`chosen` holds their ids),
// plus the CREATE SCHEMA and the schema's grants for schemas to create, which
// pg_restore -n leaves out.
export function restoreListFor(
  contents: string[],
  chosen: Set<string>,
  create: string[],
): string[] {
  return contents.filter((line) => {
    const id = TOC_ENTRY.exec(line)?.[1];
    if (!id) return false;
    if (chosen.has(id)) return true;
    const schema =
      SCHEMA_ENTRY.exec(line)?.[1] ?? SCHEMA_DETAIL.exec(line)?.[1];
    return schema !== undefined && create.includes(schema);
  });
}

function buildRemoteAdapter(
  storage: CLIConfig['storage'],
  deps?: RestoreStandaloneDeps,
): IStorageAdapter {
  if (storage.provider === 'managed') {
    if (!deps?.managed) {
      throw new Error(
        'DBDock storage needs an active session. Run `dbdock login` and try again.',
      );
    }
    return new ManagedStorageAdapter(deps.managed);
  }
  switch (storage.provider) {
    case 's3': {
      if (!storage.s3?.accessKeyId || !storage.s3?.secretAccessKey) {
        throw new Error('S3 credentials are required');
      }
      return new S3StorageAdapter({
        endpoint: storage.s3.endpoint,
        region: storage.s3.region,
        bucket: storage.s3.bucket || '',
        accessKeyId: storage.s3.accessKeyId,
        secretAccessKey: storage.s3.secretAccessKey,
      });
    }
    case 'r2': {
      if (!storage.s3?.accessKeyId || !storage.s3?.secretAccessKey) {
        throw new Error('R2 credentials are required');
      }
      if (!storage.s3?.endpoint) {
        throw new Error('R2 endpoint is required');
      }
      const accountId = storage.s3.endpoint.match(/https:\/\/([^.]+)/)?.[1];
      if (!accountId) {
        throw new Error('Invalid R2 endpoint format');
      }
      return new R2StorageAdapter({
        accountId,
        bucket: storage.s3.bucket || '',
        accessKeyId: storage.s3.accessKeyId,
        secretAccessKey: storage.s3.secretAccessKey,
      });
    }
    case 'cloudinary': {
      if (
        !storage.cloudinary?.cloudName ||
        !storage.cloudinary?.apiKey ||
        !storage.cloudinary?.apiSecret
      ) {
        throw new Error('Cloudinary credentials are required');
      }
      return new CloudinaryStorageAdapter({
        cloudName: storage.cloudinary.cloudName,
        apiKey: storage.cloudinary.apiKey,
        apiSecret: storage.cloudinary.apiSecret,
        folder: 'dbdock_backups',
      });
    }
    default:
      throw new Error(`Unknown storage provider: ${storage.provider}`);
  }
}

function peekBackupHeader(
  filePath: string,
  length: number = BACKUP_HEADER_LENGTH,
): Buffer {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const bytesRead = readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

async function openSourceStream(
  config: CLIConfig,
  storageKey: string,
  callbacks: RestoreProgressCallback | undefined,
  tempFiles: string[],
  deps?: RestoreStandaloneDeps,
): Promise<{ path: string }> {
  if (callbacks?.onStage) {
    callbacks.onStage('Downloading backup');
  }

  if (config.storage.provider === 'local') {
    const basePath = resolve(config.storage.local?.path || './backups');
    if (storageKey.split(/[\\/]/).includes('..')) {
      throw new Error(`Invalid backup key: ${storageKey}`);
    }
    const candidate = storageKey.includes('/')
      ? resolve(storageKey)
      : resolve(basePath, storageKey);
    if (candidate !== basePath && !candidate.startsWith(basePath + sep)) {
      throw new Error(`Backup key escapes storage directory: ${storageKey}`);
    }
    if (!existsSync(candidate)) {
      throw new Error(`Backup file not found: ${candidate}`);
    }
    return { path: candidate };
  }

  const adapter = buildRemoteAdapter(config.storage, deps);
  const tempDir = mkdtempSync(join(tmpdir(), 'dbdock-'));
  const tempFilePath = join(tempDir, 'restore.bin');
  tempFiles.push(tempFilePath);

  const downloadStream = await adapter.downloadStream({ key: storageKey });
  const tempWriteStream = createWriteStream(tempFilePath, { mode: 0o600 });

  let downloadedBytes = 0;
  downloadStream.on('data', (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    if (callbacks?.onProgress) {
      callbacks.onProgress(downloadedBytes);
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    downloadStream.pipe(tempWriteStream);
    downloadStream.on('error', reject);
    tempWriteStream.on('error', reject);
    tempWriteStream.on('finish', resolvePromise);
  });

  return { path: tempFilePath };
}

export async function restoreBackupStandalone(
  config: CLIConfig,
  options: RestoreStandaloneOptions,
  callbacks?: RestoreProgressCallback,
  deps?: RestoreStandaloneDeps,
): Promise<void> {
  const engine = getEngine(config.database.type);
  const target = options.target || config.database;
  const tempFiles: string[] = [];

  const cleanup = () => {
    for (const file of tempFiles) {
      if (existsSync(file)) {
        unlinkSync(file);
      }
      const dir = dirname(file);
      if (dir.startsWith(join(tmpdir(), 'dbdock-')) && existsSync(dir)) {
        try {
          rmdirSync(dir);
        } catch {
          void 0;
        }
      }
    }
  };

  try {
    const source = await openSourceStream(
      config,
      options.storageKey,
      callbacks,
      tempFiles,
      deps,
    );

    if (options.checksum) {
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(source.path))
        digest.update(chunk as Buffer);
      if (digest.digest('hex') !== options.checksum)
        throw new Error(
          'Checkpoint file is damaged. The database was not changed.',
        );
    }

    let restoreFlags = options.restoreFlags;
    let selection: SchemaSelection | undefined;
    if (options.beforeRestore || options.selectSchemas) {
      callbacks?.onStage?.('Verifying backup');
      await verifyBackupDecodes(config, source.path);
    }
    if (options.selectSchemas) {
      const contents = await listArchive(engine, config, source.path);
      selection = await options.selectSchemas(archiveSchemas(contents));
      const chosen = selection.restore.length
        ? await listArchive(engine, config, source.path, selection.restore)
        : [];
      const ids = new Set(
        chosen.flatMap((line) => TOC_ENTRY.exec(line)?.[1] ?? []),
      );
      restoreFlags = {
        ...restoreFlags,
        listFile: writeRestoreList(
          restoreListFor(contents, ids, selection.create),
          tempFiles,
        ),
      };
    }
    if (options.beforeRestore) {
      callbacks?.onStage?.('Preparing target database');
      await options.beforeRestore(selection?.restore);
    }

    const stream = chainStages(
      decodeStages(config, source.path, callbacks?.onStage),
    );

    if (callbacks?.onStage) {
      callbacks.onStage('Restoring to database');
    }

    const restoreProcess = engine.spawnRestore(target, restoreFlags);
    stream.pipe(restoreProcess.stdin);

    await new Promise<void>((resolve, reject) => {
      let errorOutput = '';
      let fullOutput = '';
      let hasWarnings = false;

      stream.on('error', (err: Error) => {
        restoreProcess.kill();
        reject(new Error(`Failed to read backup data: ${err.message}`));
      });

      restoreProcess.stderr.on('data', (data: Buffer) => {
        const message = data.toString();
        fullOutput += message;
        if (engine.shouldIgnoreRestoreMessage(message)) {
          hasWarnings = true;
        } else if (message.trim()) {
          errorOutput += message;
        }
      });

      restoreProcess.on('error', (err) => {
        reject(
          new Error(
            `Failed to start the restore process: ${err.message}\n\n${engine.clientToolHint}`,
          ),
        );
      });

      restoreProcess.on('close', (code) => {
        if (options.strict) {
          const failure = strictRestoreFailure(engine.id, code, fullOutput);
          if (failure === undefined) {
            resolve();
          } else if (failure) {
            reject(new Error(engine.formatRestoreError(failure)));
          } else {
            reject(new Error(`Restore exited with code ${code}`));
          }
          return;
        }
        if (code === 0 || (code === 1 && !errorOutput && hasWarnings)) {
          resolve();
        } else if (errorOutput) {
          reject(new Error(engine.formatRestoreError(errorOutput)));
        } else {
          reject(new Error(`Restore exited with code ${code}`));
        }
      });
    });
  } finally {
    cleanup();
  }
}

function decodeStages(
  config: CLIConfig,
  sourcePath: string,
  onStage?: (stage: string) => void,
): [Readable, ...Transform[]] {
  if (config.backup?.encryption?.enabled && !config.backup.encryption.key) {
    throw new Error(
      'Encryption is enabled but no key is configured. Set DBDOCK_ENCRYPTION_SECRET in your .env, or disable backup.encryption.enabled.',
    );
  }

  const stages: [Readable, ...Transform[]] = [createReadStream(sourcePath)];

  if (config.backup?.encryption?.enabled && config.backup.encryption.key) {
    onStage?.('Decrypting backup');
    const keyBuffer = Buffer.from(config.backup.encryption.key, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error(
        `Invalid encryption key length: ${keyBuffer.length} bytes (expected 32 bytes)`,
      );
    }
    const headerPrefix = peekBackupHeader(
      sourcePath,
      BACKUP_HEADER_LENGTH + KEY_FINGERPRINT_LENGTH,
    );
    const isVersioned = hasBackupHeader(headerPrefix);
    if (readBackupVersion(headerPrefix) === BACKUP_VERSION_GCM_FP) {
      const storedFingerprint = headerPrefix.subarray(
        BACKUP_HEADER_LENGTH,
        BACKUP_HEADER_LENGTH + KEY_FINGERPRINT_LENGTH,
      );
      const providedFingerprint = computeKeyFingerprint(keyBuffer);
      if (!storedFingerprint.equals(providedFingerprint)) {
        throw new Error(
          `${WRONG_KEY_MESSAGE}\n\n` +
            `  Backup was created with key fingerprint: ${formatKeyFingerprint(storedFingerprint)}\n` +
            `  Your configured key fingerprint:         ${formatKeyFingerprint(providedFingerprint)}`,
        );
      }
    }
    stages.push(
      isVersioned
        ? createBackupDecryptStream(keyBuffer)
        : createLegacyDecryptStream(keyBuffer),
    );
  }

  if (config.backup?.compression?.enabled) {
    onStage?.('Decompressing backup');
    stages.push(createBrotliDecompress());
  }

  return stages;
}

function writeRestoreList(lines: string[], tempFiles: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbdock-'));
  const file = join(dir, 'restore.list');
  writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  tempFiles.push(file);
  return file;
}

// Reads the archive's table of contents through pg_restore -l, limited to
// `schemas` when given. pg_restore stops reading once it has the contents, so
// the rest of the stream is dropped.
async function listArchive(
  engine: DatabaseEngine,
  config: CLIConfig,
  sourcePath: string,
  schemas?: string[],
): Promise<string[]> {
  if (!engine.spawnList)
    throw new Error(`${engine.label} backups cannot be restored by schema.`);
  const list = engine.spawnList(schemas);
  const stages = decodeStages(config, sourcePath);
  return new Promise<string[]>((resolve, reject) => {
    let output = '';
    let errors = '';
    list.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    list.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    list.stdin.on('error', () => undefined);
    list.on('error', (err) =>
      reject(
        new Error(
          `Failed to read the backup contents: ${err.message}\n\n${engine.clientToolHint}`,
        ),
      ),
    );
    list.on('close', (code) => {
      for (const stage of stages) stage.destroy();
      if (code === 0)
        resolve(output.split('\n').filter((line) => TOC_ENTRY.test(line)));
      else
        reject(
          new Error(
            `Could not read the backup contents: ${errors.trim() || `pg_restore exited with code ${code}`}`,
          ),
        );
    });
    const stream = chainStages(stages);
    stream.on('error', () => undefined);
    stream.pipe(list.stdin);
  });
}

function chainStages([source, ...transforms]: [Readable, ...Transform[]]):
  | Readable
  | Transform {
  return transforms.reduce<Readable | Transform>(
    (stream, next) => stream.pipe(next),
    source,
  );
}

// GCM only authenticates at the end of the stream, so a corrupt or truncated
// backup would otherwise be discovered after beforeRestore had already wiped
// the target. Decode it once into nothing first; no plaintext touches disk.
async function verifyBackupDecodes(
  config: CLIConfig,
  sourcePath: string,
): Promise<void> {
  const discard = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      pipeline([...decodeStages(config, sourcePath), discard], (err) =>
        err ? reject(err) : resolve(),
      );
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `The backup could not be fully decrypted and decompressed, so the target database was left untouched: ${reason}`,
    );
  }
}

// Returns undefined on success, the harmful output to report, or '' when the
// restore failed without saying why.
function strictRestoreFailure(
  engineId: string,
  code: number | null,
  output: string,
): string | undefined {
  if (code === 0) return undefined;
  if (engineId !== 'postgresql') return output.trim();
  if (code === 1 && isHarmlessPgRestoreWarning(output)) return undefined;
  const { harmful } = summarizePgRestoreOutput(output);
  return harmful.length > 0 ? harmful.join('\n') : output.trim();
}
