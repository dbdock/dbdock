import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  type DecipherGCM,
} from 'crypto';
import { Transform, TransformCallback } from 'stream';
import { BACKUP_HEADER } from './backup-format';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const LEGACY_ALGORITHM = 'aes-256-cbc';

function deriveKey(keyMaterial: Buffer, salt: Buffer): Buffer {
  return pbkdf2Sync(keyMaterial, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

export function createBackupEncryptStream(keyMaterial: Buffer): Transform {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(keyMaterial, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let headerWritten = false;

  return new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      try {
        if (!headerWritten) {
          this.push(Buffer.concat([BACKUP_HEADER, salt, iv]));
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
          this.push(Buffer.concat([BACKUP_HEADER, salt, iv]));
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
  const headerTotal = BACKUP_HEADER.length + SALT_LENGTH + IV_LENGTH;

  return new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      try {
        if (!headerParsed) {
          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          if (headerBuffer.length < headerTotal) {
            callback();
            return;
          }
          const salt = headerBuffer.subarray(
            BACKUP_HEADER.length,
            BACKUP_HEADER.length + SALT_LENGTH,
          );
          const iv = headerBuffer.subarray(
            BACKUP_HEADER.length + SALT_LENGTH,
            headerTotal,
          );
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
