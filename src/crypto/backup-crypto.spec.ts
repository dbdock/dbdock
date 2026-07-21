import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import {
  WRONG_KEY_MESSAGE,
  createBackupEncryptStream,
  createBackupDecryptStream,
} from './backup-crypto';
import {
  BACKUP_HEADER_LENGTH,
  BACKUP_VERSION_GCM_FP,
  KEY_FINGERPRINT_LENGTH,
  computeKeyFingerprint,
  readBackupVersion,
} from './backup-format';

async function pump(input: Buffer, ...transforms: NodeJS.ReadWriteStream[]) {
  let stream: NodeJS.ReadableStream = Readable.from([input]);
  for (const t of transforms) {
    stream = stream.pipe(t);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

describe('backup-crypto v3 (fingerprinted)', () => {
  const key = randomBytes(32);
  const plaintext = randomBytes(5000);

  it('round-trips encrypt then decrypt with the same key', async () => {
    const encrypted = await pump(plaintext, createBackupEncryptStream(key));
    const decrypted = await pump(encrypted, createBackupDecryptStream(key));
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('writes a v3 header carrying the key fingerprint', async () => {
    const encrypted = await pump(plaintext, createBackupEncryptStream(key));
    expect(readBackupVersion(encrypted)).toBe(BACKUP_VERSION_GCM_FP);
    const storedFingerprint = encrypted.subarray(
      BACKUP_HEADER_LENGTH,
      BACKUP_HEADER_LENGTH + KEY_FINGERPRINT_LENGTH,
    );
    expect(storedFingerprint.equals(computeKeyFingerprint(key))).toBe(true);
  });

  it('rejects a wrong key with the wrong-key message', async () => {
    const encrypted = await pump(plaintext, createBackupEncryptStream(key));
    const wrongKey = randomBytes(32);
    await expect(
      pump(encrypted, createBackupDecryptStream(wrongKey)),
    ).rejects.toThrow(WRONG_KEY_MESSAGE);
  });
});
