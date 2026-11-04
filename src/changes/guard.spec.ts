import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runGuardedChange } from '@/changes/guard';
import { saveCheckpoint } from '@/changes/storage';
import { saveRecord, sendRecord } from '@/changes/records';
import { lockDatabase } from '@/changes/database';
import { ApiClient } from '@/cloud/api-client';
import { sqlSummary } from '@/changes/metadata';
import type { CLIConfig } from '@/cli/utils/config';

jest.mock('@/changes/storage', () => ({
  saveCheckpoint: jest.fn(),
  ignoreArtifacts: jest.fn(),
}));
jest.mock('@/changes/records', () => ({
  saveRecord: jest.fn(),
  sendRecord: jest.fn(),
}));
jest.mock('@/changes/database', () => ({ lockDatabase: jest.fn() }));

const config: CLIConfig = {
  database: {
    type: 'postgresql',
    host: 'private-host',
    database: 'private-db',
    password: 'private-password-2718',
  },
  storage: { provider: 'local', local: { path: '/tmp/checkpoints' } },
  backup: { encryption: { enabled: false } },
};

describe('Guarded changes', () => {
  const database = {
    schema: jest.fn().mockResolvedValue({ tables: [], columns: {} }),
    execute: jest.fn(),
    reset: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  let cwd: string;
  beforeEach(() => {
    jest.clearAllMocks();
    cwd = mkdtempSync(join(tmpdir(), 'dbdock-guard-test-'));
    jest.mocked(lockDatabase).mockResolvedValue(database);
    jest.mocked(saveCheckpoint).mockResolvedValue({
      id: 'cp_abcdefghijklmnopqrstu',
      createdAt: new Date().toISOString(),
      targetHash: 'hash',
      databaseType: 'postgresql',
      storageKey: '/private/checkpoint',
      size: 10,
      checksum: 'a'.repeat(64),
      encrypted: false,
      compressed: true,
      keyFingerprint: null,
    });
    jest.mocked(saveRecord).mockResolvedValue(undefined);
    jest.mocked(sendRecord).mockResolvedValue(true);
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('refuses the change when the checkpoint fails', async () => {
    jest
      .mocked(saveCheckpoint)
      .mockRejectedValueOnce(new Error('Storage failed'));
    const change = jest.fn();
    await expect(runGuardedChange(change, { config, cwd })).rejects.toThrow(
      'Storage failed',
    );
    expect(change).not.toHaveBeenCalled();
    expect(saveRecord).not.toHaveBeenCalled();
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it('refuses the change when the local record cannot be saved', async () => {
    jest.mocked(saveRecord).mockRejectedValueOnce(new Error('Disk full'));
    const change = jest.fn();
    await expect(runGuardedChange(change, { config, cwd })).rejects.toThrow(
      'Disk full',
    );
    expect(change).not.toHaveBeenCalled();
  });

  it('sends one record after the checkpoint and command complete', async () => {
    const change = jest.fn().mockResolvedValue('done');
    const result = await runGuardedChange(change, { config, cwd });
    expect(result.value).toBe('done');
    expect(sendRecord).toHaveBeenCalledTimes(1);
    expect(sendRecord).toHaveBeenCalledWith(
      cwd,
      expect.objectContaining({
        checkpointId: 'cp_abcdefghijklmnopqrstu',
        status: 'succeeded',
        actorKind: 'person',
      }),
    );
    expect(
      jest.mocked(saveCheckpoint).mock.invocationCallOrder[0],
    ).toBeLessThan(change.mock.invocationCallOrder[0]);
    expect(jest.mocked(saveRecord).mock.invocationCallOrder[0]).toBeLessThan(
      change.mock.invocationCallOrder[0],
    );
  });

  it('keeps the failed command record and never repeats the change', async () => {
    const change = jest.fn().mockRejectedValue(new Error('Migration failed'));
    await expect(runGuardedChange(change, { config, cwd })).rejects.toThrow(
      'Migration failed',
    );
    expect(change).toHaveBeenCalledTimes(1);
    expect(sendRecord).toHaveBeenCalledTimes(1);
    expect(sendRecord).toHaveBeenCalledWith(
      cwd,
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('keeps the successful result when Cloud is offline', async () => {
    jest.mocked(sendRecord).mockResolvedValueOnce(false);
    const result = await runGuardedChange(() => Promise.resolve('done'), {
      config,
      cwd,
    });
    expect(result.synced).toBe(false);
    expect(result.value).toBe('done');
  });

  it('excludes credentials, raw SQL and row data from the actual Cloud request', async () => {
    const rawSql =
      "DELETE FROM customers WHERE email = 'secret-row@example.com'";
    const result = await runGuardedChange(() => Promise.resolve(undefined), {
      config,
      cwd,
      actor:
        'postgresql://person:private-password-2718@private-host/private-db',
      summary: sqlSummary(rawSql),
      kind: 'sql',
    });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));
    try {
      await new ApiClient(
        'https://api.example.test/api/v1',
        'cloud-login-token',
      ).ingestChange('proj_test', result.record);
      const body = fetchMock.mock.calls[0][1]?.body;
      if (typeof body !== 'string')
        throw new Error('Expected JSON request body');
      for (const privateValue of [
        'postgresql://',
        'private-password-2718',
        'private-host',
        'private-db',
        'secret-row@example.com',
        rawSql,
        '/private/checkpoint',
      ])
        expect(body).not.toContain(privateValue);
      expect(JSON.parse(body)).toEqual(
        expect.objectContaining({
          summary: 'SQL operations: DELETE',
          checkpointId: 'cp_abcdefghijklmnopqrstu',
        }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
