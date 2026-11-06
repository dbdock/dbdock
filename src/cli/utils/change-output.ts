import { formatFileSize } from '@/utils/format';
import type { ChangeRecord, Checkpoint } from '@/changes/types';

const LABEL_WIDTH = 20;

// One aligned status line: a mark, a short label, then the detail.
export function line(
  mark: '✓' | '✗' | '→' | ' ',
  label: string,
  detail = '',
): string {
  return `${mark} ${label.padEnd(LABEL_WIDTH)}${detail}`.trimEnd();
}

// "Schema changes: 1 table added, 0 tables removed, 3 columns added, ..."
// reads as "1 table added, 3 columns added".
export function shortSummary(summary: string): string {
  const prefix = 'Schema changes: ';
  if (!summary.startsWith(prefix)) return summary;
  const parts = summary
    .slice(prefix.length)
    .split(', ')
    .filter((part) => !part.startsWith('0 '));
  return parts.length ? parts.join(', ') : 'No schema change';
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function storageLabel(
  storage: ChangeRecord['checkpointStorage'],
): string {
  switch (storage) {
    case 'local':
      return 'local disk';
    case 's3':
      return 'S3 bucket';
    case 'r2':
      return 'R2 bucket';
    case 'cloud':
      return 'DBDock Cloud backup';
  }
}

export function statusLabel(status: ChangeRecord['status']): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
  }
}

export function checkpointLine(
  checkpoint: Checkpoint,
  durationMs: number,
  storage: ChangeRecord['checkpointStorage'],
): string {
  const details = [
    checkpoint.schemas?.join(', '),
    formatFileSize(checkpoint.size),
    `${(durationMs / 1000).toFixed(1)} s`,
    storageLabel(storage),
    checkpoint.encrypted ? undefined : 'not encrypted',
  ].filter(Boolean);
  return line(
    '✓',
    'Checkpoint saved',
    `${checkpoint.id}   ${details.join(' · ')}`,
  );
}

// Every run ends with this: either the record reached DBDock Cloud, or why not.
export function deliveryLines(
  recordId: string,
  delivery: { sent: boolean; reason?: string },
): string[] {
  if (delivery.sent)
    return [line('✓', 'Recorded', `${recordId} · sent to DBDock Cloud`)];
  return [
    line('✗', 'Not recorded', delivery.reason ?? 'The record was not sent.'),
    line(
      ' ',
      '',
      `Saved on this machine as ${recordId}. Send it later with npx dbdock sync.`,
    ),
  ];
}

export const UNDO_HINT = line(' ', 'To undo:', 'npx dbdock undo');
