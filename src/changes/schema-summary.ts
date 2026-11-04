import type { SchemaSnapshot } from '@/changes/database';

export function schemaSummary(
  before: SchemaSnapshot,
  after: SchemaSnapshot,
): string | null {
  const addedTables = after.tables.filter(
    (table) => !before.tables.includes(table),
  ).length;
  const removedTables = before.tables.filter(
    (table) => !after.tables.includes(table),
  ).length;
  const addedColumns = Object.keys(after.columns).filter(
    (column) => !(column in before.columns),
  ).length;
  const removedColumns = Object.keys(before.columns).filter(
    (column) => !(column in after.columns),
  ).length;
  const changedColumns = Object.keys(after.columns).filter(
    (column) =>
      column in before.columns &&
      before.columns[column] !== after.columns[column],
  ).length;
  if (
    !addedTables &&
    !removedTables &&
    !addedColumns &&
    !removedColumns &&
    !changedColumns
  )
    return null;
  const count = (number: number, noun: string, verb: string) =>
    `${number} ${noun}${number === 1 ? '' : 's'} ${verb}`;
  return `Schema changes: ${[count(addedTables, 'table', 'added'), count(removedTables, 'table', 'removed'), count(addedColumns, 'column', 'added'), count(removedColumns, 'column', 'removed'), count(changedColumns, 'column', 'changed')].join(', ')}`;
}
