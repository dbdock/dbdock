import { readHistory, type HistoryEntry } from '@/changes/history';
import {
  shortSummary,
  statusLabel,
  storageLabel,
  when,
} from '@/cli/utils/change-output';

const CHANGE_WIDTH = 48;

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

function row({ record, inCloud }: HistoryEntry): string[] {
  return [
    when(record.occurredAt),
    `${record.actor}${record.actorKind === 'agent' ? ' (agent)' : ''}`,
    clip(shortSummary(record.summary), CHANGE_WIDTH),
    `${statusLabel(record.status)}${inCloud ? '' : ', not sent'}`,
    `${record.checkpointId} (${storageLabel(record.checkpointStorage)})`,
  ];
}

export async function changesCommand(options: {
  limit?: number;
}): Promise<void> {
  try {
    const history = await readHistory(process.cwd(), options.limit ?? 10);
    if (!history.entries.length) {
      console.log('No changes have gone through DBDock yet.');
    } else {
      const rows = [
        ['When', 'Who', 'Change', 'Status', 'Checkpoint'],
        ...history.entries.map(row),
      ];
      const widths = rows[0].map((_, column) =>
        Math.max(...rows.map((cells) => cells[column].length)),
      );
      for (const cells of rows)
        console.log(
          cells
            .map((cell, column) => cell.padEnd(widths[column]))
            .join('  ')
            .trimEnd(),
        );
      console.log('');
      console.log(
        'Undo the latest: npx dbdock undo · an older one: npx dbdock undo <checkpoint>',
      );
    }
    if (history.cloudNote) console.log(history.cloudNote);
    console.log(
      'Changes made directly with the database URL are not recorded.',
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Could not read changes.',
    );
    process.exitCode = 1;
  }
}
