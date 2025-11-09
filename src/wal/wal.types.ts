export enum WalStatus {
  PENDING = 'pending',
  ARCHIVING = 'archiving',
  ARCHIVED = 'archived',
  FAILED = 'failed',
}

export interface WalMetadata {
  fileName: string;
  timeline: number;
  logSegmentNumber: string;
  status: WalStatus;
  archiveTime: Date;
  size: number;
  storageKey: string;
  checksum?: string;
  error?: string;
}

export interface WalArchiveOptions {
  walFile: string;
  walPath: string;
}

export interface WalArchiveResult {
  success: boolean;
  fileName: string;
  storageKey: string;
  size: number;
}
