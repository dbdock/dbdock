import { archiveSchemas, restoreListFor } from './restore-standalone';

// pg_restore -l output from PostgreSQL 16 for a database with public, a
// billing schema the app owns, an auth schema it does not, and citext.
const CONTENTS = [
  '8; 2615 16634 SCHEMA - billing app',
  '3511; 0 0 ACL - SCHEMA billing app',
  '9; 2615 16700 SCHEMA - auth postgres',
  '3510; 0 0 ACL - SCHEMA auth postgres',
  '2; 3079 16387 EXTENSION - citext ',
  '3512; 0 0 COMMENT - EXTENSION citext ',
  '219; 1259 16635 TABLE billing invoices app',
  '218; 1259 16701 TABLE auth users postgres',
  '220; 1259 16641 TABLE public orders app',
  '3514; 0 0 ACL public TABLE orders app',
  '3501; 0 16635 TABLE DATA billing invoices app',
  '3500; 0 16701 TABLE DATA auth users postgres',
  '3502; 0 16641 TABLE DATA public orders app',
  '2134; 826 16640 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES app',
];

describe('archiveSchemas', () => {
  it('lists every schema with an entry, plus public', () => {
    expect(archiveSchemas(CONTENTS).sort()).toEqual([
      'auth',
      'billing',
      'public',
    ]);
    expect(archiveSchemas([])).toEqual(['public']);
  });
});

describe('restoreListFor', () => {
  const chosen = new Set(['219', '220', '3514', '3501', '3502', '2134']);

  it('keeps the chosen entries in archive order and creates only missing schemas', () => {
    expect(restoreListFor(CONTENTS, chosen, ['billing'])).toEqual([
      '8; 2615 16634 SCHEMA - billing app',
      '3511; 0 0 ACL - SCHEMA billing app',
      '219; 1259 16635 TABLE billing invoices app',
      '220; 1259 16641 TABLE public orders app',
      '3514; 0 0 ACL public TABLE orders app',
      '3501; 0 16635 TABLE DATA billing invoices app',
      '3502; 0 16641 TABLE DATA public orders app',
      '2134; 826 16640 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES app',
    ]);
  });

  it('never adds a schema, extension or object that was not chosen', () => {
    const list = restoreListFor(CONTENTS, chosen, []);
    expect(list.some((line) => line.includes('SCHEMA - billing'))).toBe(false);
    expect(list.some((line) => line.includes(' auth '))).toBe(false);
    expect(list.some((line) => line.includes('EXTENSION'))).toBe(false);
    expect(restoreListFor(CONTENTS, new Set(), [])).toEqual([]);
  });
});
