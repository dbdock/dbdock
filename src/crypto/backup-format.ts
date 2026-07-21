import { createHash } from 'crypto';

export const BACKUP_MAGIC = Buffer.from('DBDKENC', 'ascii');
export const BACKUP_VERSION_GCM = 0x02;
export const BACKUP_VERSION_GCM_FP = 0x03;
export const KEY_FINGERPRINT_LENGTH = 8;
export const KEY_FINGERPRINT_INFO = 'dbdock-keyfp-v1';

export const BACKUP_HEADER = Buffer.concat([
  BACKUP_MAGIC,
  Buffer.from([BACKUP_VERSION_GCM]),
]);
export const BACKUP_HEADER_FP = Buffer.concat([
  BACKUP_MAGIC,
  Buffer.from([BACKUP_VERSION_GCM_FP]),
]);
export const BACKUP_HEADER_LENGTH = BACKUP_HEADER.length;

export function hasBackupHeader(prefix: Buffer): boolean {
  const version = readBackupVersion(prefix);
  return version === BACKUP_VERSION_GCM || version === BACKUP_VERSION_GCM_FP;
}

export function readBackupVersion(prefix: Buffer): number | null {
  if (prefix.length < BACKUP_HEADER_LENGTH) {
    return null;
  }
  if (!prefix.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    return null;
  }
  return prefix[BACKUP_MAGIC.length];
}

export function computeKeyFingerprint(keyMaterial: Buffer): Buffer {
  return createHash('sha256')
    .update(KEY_FINGERPRINT_INFO)
    .update(keyMaterial)
    .digest()
    .subarray(0, KEY_FINGERPRINT_LENGTH);
}

export function formatKeyFingerprint(fingerprint: Buffer): string {
  return (fingerprint.toString('hex').toUpperCase().match(/.{2}/g) ?? []).join(
    ':',
  );
}
