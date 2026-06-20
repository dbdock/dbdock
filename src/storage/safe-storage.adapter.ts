import { Logger } from '@nestjs/common';
import { Readable } from 'stream';
import {
  IStorageAdapter,
  UploadOptions,
  DownloadOptions,
  ListOptions,
  StorageObject,
  DeleteOptions,
  CopyOptions,
  PresignedUrlOptions,
} from './storage.interface';
import {
  DeletionGuardPolicy,
  DeletionGuardError,
  DeletionRateLimiter,
  assertDeletableKey,
  isWithinAllowedPrefix,
  validateKeyStructure,
} from './deletion-guard';

const TRASH_META_SUFFIX = '.trashmeta.json';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StorageDeletionEvent {
  key: string;
  softDeleted: boolean;
  trashKey: string | null;
  reason: string | null;
}

export type StorageDeletionListener = (
  event: StorageDeletionEvent,
) => void | Promise<void>;

interface TrashMeta {
  originalKey: string;
  deletedAt: string;
  reason: string | null;
}

export class SafeStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(SafeStorageAdapter.name);
  private readonly rateLimiter: DeletionRateLimiter;

  constructor(
    private readonly inner: IStorageAdapter,
    private readonly policy: DeletionGuardPolicy,
    private readonly listener?: StorageDeletionListener,
  ) {
    this.rateLimiter = new DeletionRateLimiter(
      policy.maxDeletesPerWindow,
      policy.windowMs,
    );
  }

  uploadStream(
    stream: Readable,
    options: UploadOptions,
  ): Promise<{ key: string; etag?: string }> {
    return this.inner.uploadStream(stream, options);
  }

  downloadStream(options: DownloadOptions): Promise<Readable> {
    return this.inner.downloadStream(options);
  }

  listObjects(options?: ListOptions): Promise<StorageObject[]> {
    return this.inner.listObjects(options);
  }

  generatePresignedUrl(options: PresignedUrlOptions): Promise<string> {
    return this.inner.generatePresignedUrl(options);
  }

  objectExists(key: string): Promise<boolean> {
    return this.inner.objectExists(key);
  }

  async copyObject(options: CopyOptions): Promise<void> {
    if (this.inner.copyObject) {
      await this.inner.copyObject(options);
      return;
    }
    const stream = await this.inner.downloadStream({
      key: options.sourceKey,
    });
    await this.inner.uploadStream(stream, { key: options.destinationKey });
  }

  async deleteObject(options: DeleteOptions): Promise<void> {
    const key = options.key;
    const reason = options.reason ?? null;

    if (!this.policy.enabled) {
      validateKeyStructure(key);
      await this.inner.deleteObject({ key });
      await this.emit({ key, softDeleted: false, trashKey: null, reason });
      return;
    }

    assertDeletableKey(key, this.policy.allowedPrefixes);
    this.rateLimiter.record(Date.now());

    if (this.policy.recycleBin && !key.startsWith(this.policy.trashPrefix)) {
      const trashKey = await this.moveToTrash(key, reason);
      await this.emit({ key, softDeleted: true, trashKey, reason });
      return;
    }

    await this.inner.deleteObject({ key });
    await this.emit({ key, softDeleted: false, trashKey: null, reason });
  }

  async restoreFromTrash(trashKey: string): Promise<string> {
    const metaKey = `${trashKey}${TRASH_META_SUFFIX}`;
    const meta = await this.readTrashMeta(metaKey);
    const originalKey = meta?.originalKey ?? null;

    if (!originalKey) {
      throw new DeletionGuardError(
        'Cannot restore: missing trash metadata',
        trashKey,
      );
    }

    await this.copyObject({ sourceKey: trashKey, destinationKey: originalKey });
    await this.hardDelete(trashKey);
    await this.bestEffortHardDelete(metaKey);
    this.logger.warn(`[storage-audit] restored ${trashKey} -> ${originalKey}`);
    return originalKey;
  }

  async purgeTrash(olderThanDays?: number): Promise<number> {
    const maxAgeDays = olderThanDays ?? this.policy.trashRetentionDays;
    const cutoff = Date.now() - maxAgeDays * MS_PER_DAY;
    const objects = await this.inner.listObjects({
      prefix: this.policy.trashPrefix,
    });

    let purged = 0;
    for (const obj of objects) {
      if (obj.key.endsWith(TRASH_META_SUFFIX)) continue;
      if (obj.lastModified.getTime() >= cutoff) continue;
      await this.hardDelete(obj.key);
      await this.bestEffortHardDelete(`${obj.key}${TRASH_META_SUFFIX}`);
      purged++;
    }

    if (purged > 0) {
      this.logger.warn(
        `[storage-audit] purged ${purged} trashed object(s) older than ${maxAgeDays} day(s)`,
      );
    }
    return purged;
  }

  private async moveToTrash(
    key: string,
    reason: string | null,
  ): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashKey = `${this.policy.trashPrefix}${stamp}/${key}`;

    await this.copyObject({ sourceKey: key, destinationKey: trashKey });

    const meta: TrashMeta = {
      originalKey: key,
      deletedAt: new Date().toISOString(),
      reason,
    };
    await this.inner.uploadStream(
      Readable.from([JSON.stringify(meta, null, 2)]),
      {
        key: `${trashKey}${TRASH_META_SUFFIX}`,
        contentType: 'application/json',
      },
    );

    await this.inner.deleteObject({ key });
    this.logger.warn(
      `[storage-audit] soft-deleted ${key} -> ${trashKey}${
        reason ? ` (${reason})` : ''
      }`,
    );
    return trashKey;
  }

  private async hardDelete(key: string): Promise<void> {
    validateKeyStructure(key);
    const allowed =
      isWithinAllowedPrefix(key, this.policy.allowedPrefixes) ||
      key.startsWith(this.policy.trashPrefix);
    if (!allowed) {
      throw new DeletionGuardError(
        'Refusing to hard-delete a key outside protected prefixes',
        key,
      );
    }
    await this.inner.deleteObject({ key });
  }

  private async bestEffortHardDelete(key: string): Promise<void> {
    try {
      await this.hardDelete(key);
    } catch {
      this.logger.warn(`[storage-audit] could not remove sidecar ${key}`);
    }
  }

  private async readTrashMeta(metaKey: string): Promise<TrashMeta | null> {
    try {
      const stream = (await this.inner.downloadStream({
        key: metaKey,
      })) as AsyncIterable<Buffer>;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as TrashMeta;
    } catch {
      return null;
    }
  }

  private async emit(event: StorageDeletionEvent): Promise<void> {
    if (!this.listener) return;
    try {
      await this.listener(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[storage-audit] deletion listener failed: ${message}`);
    }
  }
}
