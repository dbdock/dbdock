import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import type { Transform } from 'stream';
import { createBrotliCompress } from 'zlib';
import type { CLIConfig } from '@/cli/utils/config';
import { getEngine } from '@/engines';
import type { DumpScope } from '@/engines/engine.types';
import { createBackupEncryptStream } from '@/crypto/backup-crypto';
import type { BackupProgressCallback } from '@/standalone/backup-standalone';

export async function dumpToFile(
  config: CLIConfig,
  path: string,
  callbacks?: BackupProgressCallback,
  scope?: DumpScope,
): Promise<void> {
  const key = config.backup?.encryption?.key;
  if (
    config.backup?.encryption?.enabled &&
    (!key || !/^[a-f0-9]{64}$/i.test(key))
  )
    throw new Error(
      'Backup encryption requires a 64-character hexadecimal key.',
    );
  const engine = getEngine(config.database.type);
  callbacks?.onStage?.('Dumping database');
  const dump = engine.spawnDump(config.database, {
    format: config.backup?.format ?? 'custom',
    schemas: scope?.schemas,
    extensions: scope?.extensions,
  });
  const messages: string[] = [];
  dump.process.stderr.on('data', (data: Buffer) =>
    messages.push(data.toString()),
  );
  const completed = new Promise<void>((resolve, reject) => {
    dump.process.once('error', reject);
    dump.process.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              engine.formatDumpError(code ?? 1, messages, config.database),
            ),
          ),
    );
  });
  const transforms: Transform[] = [];
  if (config.backup?.compression?.enabled)
    transforms.push(createBrotliCompress());
  if (config.backup?.encryption?.enabled && key)
    transforms.push(createBackupEncryptStream(Buffer.from(key, 'hex')));
  const output = createWriteStream(path, { mode: 0o600 });
  let size = 0;
  const last = transforms.at(-1) ?? dump.stdout;
  last.on('data', (chunk: Buffer) => {
    size += chunk.length;
    callbacks?.onProgress?.(size);
  });
  try {
    await Promise.all([
      pipeline([dump.stdout, ...transforms, output]),
      completed,
    ]);
  } catch (error) {
    dump.process.kill();
    throw error;
  }
  if (size === 0) throw new Error('The database dump is empty.');
}
