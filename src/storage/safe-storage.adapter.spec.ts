import { Readable } from 'stream';
import { SafeStorageAdapter } from './safe-storage.adapter';
import {
  DeletionGuardError,
  resolveDeletionGuardPolicy,
} from './deletion-guard';
import {
  IStorageAdapter,
  DeleteOptions,
  CopyOptions,
} from './storage.interface';

class FakeAdapter implements IStorageAdapter {
  objects = new Map<string, string>();
  hardDeletes: string[] = [];

  uploadStream(
    _stream: Readable,
    options: { key: string },
  ): Promise<{ key: string; etag?: string }> {
    this.objects.set(options.key, 'payload');
    return Promise.resolve({ key: options.key });
  }

  downloadStream(options: { key: string }): Promise<Readable> {
    const value = this.objects.get(options.key);
    if (value === undefined) {
      return Promise.reject(new Error(`missing ${options.key}`));
    }
    return Promise.resolve(Readable.from([value]));
  }

  listObjects(): Promise<{ key: string; size: number; lastModified: Date }[]> {
    return Promise.resolve(
      [...this.objects.keys()].map((key) => ({
        key,
        size: 1,
        lastModified: new Date(0),
      })),
    );
  }

  deleteObject(options: DeleteOptions): Promise<void> {
    this.hardDeletes.push(options.key);
    this.objects.delete(options.key);
    return Promise.resolve();
  }

  generatePresignedUrl(): Promise<string> {
    return Promise.resolve('https://example.test/url');
  }

  objectExists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  copyObject(options: CopyOptions): Promise<void> {
    const value = this.objects.get(options.sourceKey);
    if (value !== undefined) this.objects.set(options.destinationKey, value);
    return Promise.resolve();
  }
}

describe('SafeStorageAdapter', () => {
  it('refuses to delete keys outside protected prefixes', async () => {
    const inner = new FakeAdapter();
    inner.objects.set('users/1/secret', 'x');
    const safe = new SafeStorageAdapter(inner, resolveDeletionGuardPolicy());

    await expect(
      safe.deleteObject({ key: 'users/1/secret' }),
    ).rejects.toBeInstanceOf(DeletionGuardError);
    expect(inner.objects.has('users/1/secret')).toBe(true);
  });

  it('soft-deletes into the trash prefix instead of hard-deleting', async () => {
    const inner = new FakeAdapter();
    inner.objects.set('backups/db/file.sql', 'x');
    const safe = new SafeStorageAdapter(inner, resolveDeletionGuardPolicy());

    await safe.deleteObject({ key: 'backups/db/file.sql', reason: 'test' });

    expect(inner.objects.has('backups/db/file.sql')).toBe(false);
    const trashed = [...inner.objects.keys()].filter((k) =>
      k.startsWith('.trash/'),
    );
    expect(trashed.some((k) => k.endsWith('backups/db/file.sql'))).toBe(true);
  });

  it('hard-deletes when the recycle bin is disabled', async () => {
    const inner = new FakeAdapter();
    inner.objects.set('backups/db/file.sql', 'x');
    const safe = new SafeStorageAdapter(
      inner,
      resolveDeletionGuardPolicy({ recycleBin: false }),
    );

    await safe.deleteObject({ key: 'backups/db/file.sql' });

    expect(inner.hardDeletes).toContain('backups/db/file.sql');
    expect(inner.objects.has('backups/db/file.sql')).toBe(false);
  });
});
