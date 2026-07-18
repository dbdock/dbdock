import { ManagedStorageAdapter, ManagedStorageError } from './managed.adapter';
import { ManagedBroker, ManagedObject } from '../../cloud/types';

function makeBroker(overrides: Partial<ManagedBroker> = {}): ManagedBroker {
  return {
    presignUpload: jest
      .fn()
      .mockResolvedValue({ url: 'https://put', key: 'dbdock_backups/x' }),
    presignDownload: jest.fn().mockResolvedValue({ url: 'https://get' }),
    listManagedObjects: jest.fn().mockResolvedValue([]),
    deleteManagedObject: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ManagedStorageAdapter', () => {
  it('maps and sorts nothing but converts list objects', async () => {
    const objects: ManagedObject[] = [
      {
        key: 'dbdock_backups/backup-1',
        size: 10,
        lastModified: '2026-01-01T00:00:00.000Z',
      },
      { key: 'other/file', size: 20, lastModified: '2026-01-02T00:00:00.000Z' },
    ];
    const broker = makeBroker({
      listManagedObjects: jest.fn().mockResolvedValue(objects),
    });
    const adapter = new ManagedStorageAdapter(broker);

    const all = await adapter.listObjects();
    expect(all).toHaveLength(2);
    expect(all[0].lastModified).toBeInstanceOf(Date);
  });

  it('filters by prefix', async () => {
    const broker = makeBroker({
      listManagedObjects: jest.fn().mockResolvedValue([
        { key: 'dbdock_backups/backup-1', size: 1, lastModified: '2026-01-01' },
        { key: 'junk/backup-2', size: 1, lastModified: '2026-01-01' },
      ]),
    });
    const adapter = new ManagedStorageAdapter(broker);
    const filtered = await adapter.listObjects({ prefix: 'dbdock_backups/' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe('dbdock_backups/backup-1');
  });

  it('delegates delete to the broker', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const adapter = new ManagedStorageAdapter(
      makeBroker({ deleteManagedObject: del }),
    );
    await adapter.deleteObject({ key: 'dbdock_backups/backup-1' });
    expect(del).toHaveBeenCalledWith('dbdock_backups/backup-1');
  });

  it('generatePresignedUrl returns a download url', async () => {
    const adapter = new ManagedStorageAdapter(
      makeBroker({
        presignDownload: jest.fn().mockResolvedValue({ url: 'https://signed' }),
      }),
    );
    const url = await adapter.generatePresignedUrl({
      key: 'dbdock_backups/backup-1',
    });
    expect(url).toBe('https://signed');
  });

  it('objectExists reflects the listing', async () => {
    const adapter = new ManagedStorageAdapter(
      makeBroker({
        listManagedObjects: jest
          .fn()
          .mockResolvedValue([
            { key: 'dbdock_backups/here', size: 1, lastModified: '2026-01-01' },
          ]),
      }),
    );
    expect(await adapter.objectExists('dbdock_backups/here')).toBe(true);
    expect(await adapter.objectExists('dbdock_backups/nope')).toBe(false);
  });

  it('rejects raw stream uploads', async () => {
    const adapter = new ManagedStorageAdapter(makeBroker());
    await expect(
      adapter.uploadStream(null as never, { key: 'x' }),
    ).rejects.toBeInstanceOf(ManagedStorageError);
  });
});
