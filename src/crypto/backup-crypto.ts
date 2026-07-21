import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  type DecipherGCM,
} from 'crypto';
import { Transform, TransformCallback } from 'stream';
import {
  BACKUP_HEADER_FP,
  BACKUP_HEADER_LENGTH,
  BACKUP_MAGIC,
  BACKUP_VERSION_GCM_FP,
  KEY_FINGERPRINT_LENGTH,
  computeKeyFingerprint,
} from './backup-format';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const LEGACY_ALGORITHM = 'aes-256-cbc';

export const WRONG_KEY_MESSAGE =
  'Decryption failed: the configured encryption key does not match the key used to create this backup. ' +
  'Restore this backup with the exact key it was created with. ' +
  'If that key is lost, this backup cannot be recovered.';

function deriveKey(keyMaterial: Buffer, salt: Buffer): Buffer {
  return pbkdf2Sync(keyMaterial, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

export function createBackupEncryptStream(keyMaterial: Buffer): Transform {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(keyMaterial, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const header = Buffer.concat([
    BACKUP_HEADER_FP,
    computeKeyFingerprint(keyMaterial),
    salt,
    iv,
  ]);

  let headerWritten = false;

  return new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      try {
        if (!headerWritten) {
          this.push(header);
          headerWritten = true;
        }
        this.push(cipher.update(chunk));
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (!headerWritten) {
          this.push(header);
          headerWritten = true;
        }
        this.push(cipher.final());
        this.push(cipher.getAuthTag());
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

export function createBackupDecryptStream(keyMaterial: Buffer): Transform {
  let headerBuffer = Buffer.alloc(0);
  let headerParsed = false;
  let decipher: DecipherGCM | null = null;
  let buffer = Buffer.alloc(0);

  return new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      try {
        if (!headerParsed) {
          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          if (headerBuffer.length < BACKUP_HEADER_LENGTH) {
            callback();
            return;
          }
          const version = headerBuffer[BACKUP_MAGIC.length];
          const fingerprintLength =
            version === BACKUP_VERSION_GCM_FP ? KEY_FINGERPRINT_LENGTH : 0;
          const headerTotal =
            BACKUP_HEADER_LENGTH + fingerprintLength + SALT_LENGTH + IV_LENGTH;
          if (headerBuffer.length < headerTotal) {
            callback();
            return;
          }
          let offset = BACKUP_HEADER_LENGTH;
          if (fingerprintLength > 0) {
            const storedFingerprint = headerBuffer.subarray(
              offset,
              offset + fingerprintLength,
            );
            if (!storedFingerprint.equals(computeKeyFingerprint(keyMaterial))) {
              callback(new Error(WRONG_KEY_MESSAGE));
              return;
            }
            offset += fingerprintLength;
          }
          const salt = headerBuffer.subarray(offset, offset + SALT_LENGTH);
          offset += SALT_LENGTH;
          const iv = headerBuffer.subarray(offset, offset + IV_LENGTH);
          offset += IV_LENGTH;
          const key = deriveKey(keyMaterial, salt);
          decipher = createDecipheriv(ALGORITHM, key, iv);
          buffer = headerBuffer.subarray(headerTotal);
          headerParsed = true;
        } else {
          buffer = Buffer.concat([buffer, chunk]);
        }

        if (decipher && buffer.length > TAG_LENGTH) {
          const dataLength = buffer.length - TAG_LENGTH;
          const data = buffer.subarray(0, dataLength);
          this.push(decipher.update(data));
          buffer = buffer.subarray(dataLength);
        }

        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (decipher && buffer.length === TAG_LENGTH) {
          decipher.setAuthTag(buffer);
          this.push(decipher.final());
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

export function createLegacyDecryptStream(keyBuffer: Buffer): Transform {
  const iv = Buffer.alloc(IV_LENGTH);
  return createDecipheriv(LEGACY_ALGORITHM, keyBuffer, iv);
}
