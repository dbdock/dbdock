import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sendRecord } from '@/changes/records';
import { readProjectConfig } from '@/cloud/project-config';
import { NotAuthenticatedError, requireSession } from '@/cloud/session';
import { ApiError, NetworkError } from '@/cloud/api-client';
import type { ChangeRecord } from '@/changes/types';

jest.mock('@/cloud/project-config', () => ({ readProjectConfig: jest.fn() }));
jest.mock('@/cloud/session', () => ({
  ...jest.requireActual<typeof import('@/cloud/session')>('@/cloud/session'),
  requireSession: jest.fn(),
}));

const record = { id: 'chg_abcdefghijklmnopqrstu' } as ChangeRecord;

describe('Sending a record to DBDock Cloud', () => {
  let cwd: string;
  const ingestChange = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    cwd = mkdtempSync(join(tmpdir(), 'dbdock-records-'));
    jest
      .mocked(readProjectConfig)
      .mockReturnValue({ projectId: 'proj_x' } as never);
    jest.mocked(requireSession).mockResolvedValue({
      client: { ingestChange },
    } as never);
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('reports a sent record', async () => {
    ingestChange.mockResolvedValue(undefined);
    expect(await sendRecord(cwd, record)).toEqual({ sent: true });
  });

  it('says the directory is not linked only when it is not', async () => {
    jest.mocked(readProjectConfig).mockReturnValue(null as never);
    expect(await sendRecord(cwd, record)).toEqual({
      sent: false,
      reason:
        'This directory is not linked to a DBDock Cloud project. Run npx dbdock link.',
    });
  });

  it('passes on what Cloud said when it refuses the record', async () => {
    ingestChange.mockRejectedValue(new ApiError(404, 'Project not found', {}));
    expect(await sendRecord(cwd, record)).toEqual({
      sent: false,
      reason: 'DBDock Cloud refused it (HTTP 404): Project not found',
    });
  });

  it('separates an unreachable Cloud and a missing sign-in', async () => {
    ingestChange.mockRejectedValue(new NetworkError('ECONNREFUSED'));
    expect((await sendRecord(cwd, record)).reason).toBe(
      'DBDock Cloud could not be reached: ECONNREFUSED',
    );
    jest.mocked(requireSession).mockRejectedValue(new NotAuthenticatedError());
    expect((await sendRecord(cwd, record)).reason).toBe(
      'Not logged in. Run `dbdock login` first.',
    );
  });
});
