import { mergeEnvContent } from './env-file';

describe('mergeEnvContent', () => {
  it('creates a fresh file when none exists', () => {
    const out = mergeEnvContent(null, { DBDOCK_DB_PASSWORD: 'secret' });
    expect(out).toContain('DBDOCK_DB_PASSWORD=secret');
    expect(out).toContain('# DBDock Secrets');
  });

  it('preserves existing variables when appending', () => {
    const existing = 'API_KEY=abc\nDATABASE_URL=postgres://x\n';
    const out = mergeEnvContent(existing, { DBDOCK_DB_PASSWORD: 'secret' });
    expect(out).toContain('API_KEY=abc');
    expect(out).toContain('DATABASE_URL=postgres://x');
    expect(out).toContain('DBDOCK_DB_PASSWORD=secret');
  });

  it('updates an existing key in place without duplicating it', () => {
    const existing = 'API_KEY=abc\nDBDOCK_DB_PASSWORD=old\n';
    const out = mergeEnvContent(existing, { DBDOCK_DB_PASSWORD: 'new' });
    expect(out).toContain('DBDOCK_DB_PASSWORD=new');
    expect(out).not.toContain('DBDOCK_DB_PASSWORD=old');
    expect(out.match(/DBDOCK_DB_PASSWORD=/g)).toHaveLength(1);
    expect(out).toContain('API_KEY=abc');
  });

  it('treats a whitespace-only file as empty', () => {
    const out = mergeEnvContent('   \n', { A: '1' });
    expect(out).toContain('# DBDock Secrets');
    expect(out).toContain('A=1');
  });

  it('does not mangle commented lines', () => {
    const existing = '# API_KEY=commented\nREAL=1\n';
    const out = mergeEnvContent(existing, { API_KEY: 'live' });
    expect(out).toContain('# API_KEY=commented');
    expect(out).toContain('API_KEY=live');
    expect(out).toContain('REAL=1');
  });
});
