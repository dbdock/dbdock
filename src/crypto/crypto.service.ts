import { Injectable, Logger } from '@nestjs/common';
import { DBDockConfigService } from '../config/config.service';
import * as crypto from 'crypto';
import { Transform, TransformCallback } from 'stream';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

export interface EncryptionMetadata {
  algorithm: string;
  salt: string;
  iv: string;
}

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly enabled: boolean;
  private readonly secret?: string;
  private readonly iterations: number;

  constructor(private configService: DBDockConfigService) {
    const encryptionConfig = this.configService.get('encryption');
    this.enabled = encryptionConfig.enabled;
    this.secret = encryptionConfig.secret;
    this.iterations = encryptionConfig.iterations || 100000;

    if (this.enabled && !this.secret) {
      throw new Error('Encryption is enabled but no secret provided');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      this.secret as string,
      salt,
      this.iterations,
      KEY_LENGTH,
      'sha512',
    );
  }

  createSelfDescribingEncryptStream(): Transform {
    if (!this.enabled || !this.secret) {
      return new Transform({
        transform(chunk, encoding, callback) {
          this.push(chunk);
          callback();
        },
      });
    }

    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = this.deriveKey(salt);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let headerWritten = false;

    return new Transform({
      transform(
        chunk: Buffer,
        encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        try {
          if (!headerWritten) {
            this.push(Buffer.concat([salt, iv]));
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
            this.push(Buffer.concat([salt, iv]));
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

  createSelfDescribingDecryptStream(): Transform {
    if (!this.enabled || !this.secret) {
      return new Transform({
        transform(chunk, encoding, callback) {
          this.push(chunk);
          callback();
        },
      });
    }

    const deriveKey = (salt: Buffer): Buffer => this.deriveKey(salt);
    const headerTotal = SALT_LENGTH + IV_LENGTH;

    let headerBuffer = Buffer.alloc(0);
    let headerParsed = false;
    let decipher: crypto.DecipherGCM | null = null;
    let buffer = Buffer.alloc(0);

    return new Transform({
      transform(
        chunk: Buffer,
        encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        try {
          if (!headerParsed) {
            headerBuffer = Buffer.concat([headerBuffer, chunk]);
            if (headerBuffer.length < headerTotal) {
              callback();
              return;
            }
            const salt = headerBuffer.subarray(0, SALT_LENGTH);
            const iv = headerBuffer.subarray(SALT_LENGTH, headerTotal);
            decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(salt), iv);
            buffer = headerBuffer.subarray(headerTotal);
            headerParsed = true;
          } else {
            buffer = Buffer.concat([buffer, chunk]);
          }

          if (decipher && buffer.length > TAG_LENGTH) {
            const dataLength = buffer.length - TAG_LENGTH;
            this.push(decipher.update(buffer.subarray(0, dataLength)));
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

  createEncryptStream(): {
    stream: Transform;
    metadata: EncryptionMetadata;
  } {
    if (!this.enabled || !this.secret) {
      return {
        stream: new Transform({
          transform(chunk, encoding, callback) {
            this.push(chunk);
            callback();
          },
        }),
        metadata: { algorithm: 'none', salt: '', iv: '' },
      };
    }

    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    const key = crypto.pbkdf2Sync(
      this.secret,
      salt,
      this.iterations,
      KEY_LENGTH,
      'sha512',
    );

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let authTag: Buffer | null = null;

    const encryptStream = new Transform({
      transform(
        chunk: Buffer,
        encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        try {
          const encrypted = cipher.update(chunk);
          this.push(encrypted);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
      flush(callback: TransformCallback) {
        try {
          const final = cipher.final();
          authTag = cipher.getAuthTag();

          this.push(final);
          this.push(authTag);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
    });

    return {
      stream: encryptStream,
      metadata: {
        algorithm: ALGORITHM,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
      },
    };
  }

  createDecryptStream(metadata: EncryptionMetadata): Transform {
    if (metadata.algorithm === 'none' || !this.enabled || !this.secret) {
      return new Transform({
        transform(chunk, encoding, callback) {
          this.push(chunk);
          callback();
        },
      });
    }

    const salt = Buffer.from(metadata.salt, 'base64');
    const iv = Buffer.from(metadata.iv, 'base64');

    const key = crypto.pbkdf2Sync(
      this.secret,
      salt,
      this.iterations,
      KEY_LENGTH,
      'sha512',
    );

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    let buffer = Buffer.alloc(0);

    return new Transform({
      transform(
        chunk: Buffer,
        encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        try {
          buffer = Buffer.concat([buffer, chunk]);

          if (buffer.length > TAG_LENGTH) {
            const dataLength = buffer.length - TAG_LENGTH;
            const data = buffer.subarray(0, dataLength);

            const decrypted = decipher.update(data);
            this.push(decrypted);

            buffer = buffer.subarray(dataLength);
          }

          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
      flush(callback: TransformCallback) {
        try {
          if (buffer.length === TAG_LENGTH) {
            decipher.setAuthTag(buffer);
            const final = decipher.final();
            this.push(final);
          }
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
    });
  }

  generateBackupKey(): string {
    return crypto.randomBytes(32).toString('base64');
  }
}
