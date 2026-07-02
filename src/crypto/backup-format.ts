export const BACKUP_MAGIC = Buffer.from('DBDKENC', 'ascii');
export const BACKUP_VERSION_GCM = 0x02;
export const BACKUP_HEADER = Buffer.concat([
  BACKUP_MAGIC,
  Buffer.from([BACKUP_VERSION_GCM]),
]);
export const BACKUP_HEADER_LENGTH = BACKUP_HEADER.length;

export function hasBackupHeader(prefix: Buffer): boolean {
  if (prefix.length < BACKUP_HEADER_LENGTH) {
    return false;
  }
  return prefix.subarray(0, BACKUP_HEADER_LENGTH).equals(BACKUP_HEADER);
}
