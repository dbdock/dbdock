import {
  checkpointLine,
  deliveryLines,
  line,
  shortSummary,
} from '@/cli/utils/change-output';
import type { Checkpoint } from '@/changes/types';

const checkpoint: Checkpoint = {
  id: 'cp_abcdefghijklmnopqrstu',
  createdAt: '2026-11-06T10:00:00.000Z',
  targetHash: 'hash',
  databaseType: 'postgresql',
  storageKey: '/tmp/x',
  size: 14336,
  checksum: 'a'.repeat(64),
  encrypted: false,
  compressed: true,
  keyFingerprint: null,
  schemas: ['public'],
  extensions: [],
};

describe('Change output', () => {
  it('drops zero counts from a schema summary', () => {
    expect(
      shortSummary(
        'Schema changes: 1 table added, 0 tables removed, 3 columns added, 0 columns removed, 0 columns changed',
      ),
    ).toBe('1 table added, 3 columns added');
    expect(
      shortSummary(
        'Schema changes: 0 tables added, 0 tables removed, 0 columns added, 0 columns removed, 0 columns changed',
      ),
    ).toBe('No schema change');
    expect(shortSummary('SQL operations: UPDATE, DELETE')).toBe(
      'SQL operations: UPDATE, DELETE',
    );
  });

  it('aligns labels into one column', () => {
    expect(line('✓', 'Recorded', 'chg_x')).toBe('✓ Recorded            chg_x');
  });

  it('says where the checkpoint went and that it is not encrypted', () => {
    expect(checkpointLine(checkpoint, 1234, 'local')).toBe(
      '✓ Checkpoint saved    cp_abcdefghijklmnopqrstu   public · 14 KB · 1.2 s · local disk · not encrypted',
    );
    expect(
      checkpointLine({ ...checkpoint, encrypted: true }, 800, 's3'),
    ).not.toContain('not encrypted');
  });

  it('ends with the reason when the record did not reach Cloud', () => {
    expect(deliveryLines('chg_x', { sent: true })).toEqual([
      '✓ Recorded            chg_x · sent to DBDock Cloud',
    ]);
    const lines = deliveryLines('chg_x', {
      sent: false,
      reason: 'DBDock Cloud refused it (HTTP 404): Project not found',
    });
    expect(lines[0]).toBe(
      '✗ Not recorded        DBDock Cloud refused it (HTTP 404): Project not found',
    );
    expect(lines[1]).toContain('npx dbdock sync');
  });
});
