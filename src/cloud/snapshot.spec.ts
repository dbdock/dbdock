import { buildSnapshot, canonicalStringify, hashResource } from './snapshot';
import { diffSnapshot } from './diff';

describe('canonicalStringify', () => {
  it('is key-order independent', () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(
      canonicalStringify({ b: 2, a: 1 }),
    );
  });

  it('canonicalizes nested objects and arrays deterministically', () => {
    const x = canonicalStringify({ z: [{ b: 1, a: 2 }], a: 'x' });
    const y = canonicalStringify({ a: 'x', z: [{ a: 2, b: 1 }] });
    expect(x).toBe(y);
  });
});

describe('hashResource', () => {
  it('produces a stable, prefixed sha256 regardless of key order', () => {
    const h = hashResource({ id: 1, name: 'a' });
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashResource({ name: 'a', id: 1 })).toBe(h);
  });
});

describe('buildSnapshot + diffSnapshot', () => {
  it('emits upsert for a new resource against an empty base', () => {
    const snap = buildSnapshot([{ resource: 'backup', id: '1', data: { size: 10 } }]);
    const changes = diffSnapshot({}, snap);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      op: 'upsert',
      resource: 'backup',
      localId: '1',
    });
    expect(changes[0].hash).toBe(snap.resources['backup:1'].hash);
  });

  it('emits delete for a resource removed since the base', () => {
    const snap = buildSnapshot([{ resource: 'backup', id: '1', data: { size: 10 } }]);
    const base = {
      'backup:1': snap.resources['backup:1'].hash,
      'backup:2': 'sha256:old',
    };
    const changes = diffSnapshot(base, snap);
    expect(changes).toEqual([{ op: 'delete', resource: 'backup', localId: '2' }]);
  });

  it('emits upsert when a resource hash changed', () => {
    const snap = buildSnapshot([{ resource: 'backup', id: '1', data: { size: 20 } }]);
    const base = { 'backup:1': 'sha256:different' };
    const changes = diffSnapshot(base, snap);
    expect(changes[0]).toMatchObject({ op: 'upsert', localId: '1' });
  });
});
