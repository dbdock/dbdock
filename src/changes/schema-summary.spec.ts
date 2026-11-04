import { schemaSummary } from '@/changes/schema-summary';

describe('Private schema summary', () => {
  it('reports counts without database identifiers', () => {
    const summary = schemaSummary(
      {
        tables: ['private_orders'],
        columns: { private_email: 'text:YES', private_old: 'text:YES' },
      },
      {
        tables: ['private_new'],
        columns: { private_email: 'text:NO', private_new: 'text:YES' },
      },
    );
    expect(summary).toBe(
      'Schema changes: 1 table added, 1 table removed, 1 column added, 1 column removed, 1 column changed',
    );
    expect(summary).not.toContain('private');
  });
  it('keeps the command summary when the schema is unchanged', () => {
    expect(
      schemaSummary(
        { tables: ['orders'], columns: {} },
        { tables: ['orders'], columns: {} },
      ),
    ).toBeNull();
  });
});
