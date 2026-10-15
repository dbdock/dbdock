import {
  lockDatabase,
  mysqlDropStatements,
  mysqlLockName,
} from './database-lock';
import { mysqlSslArgs } from '../engines/mysql.engine';

describe('mysqlDropStatements', () => {
  it('quotes names, including ones with backticks', () => {
    expect(
      mysqlDropStatements([
        { kind: 'VIEW', name: 'order_ids' },
        { kind: 'TABLE', name: 'we`ird' },
        { kind: 'PROCEDURE', name: 'refresh' },
        { kind: 'EVENT', name: 'nightly' },
      ]),
    ).toEqual([
      'DROP VIEW IF EXISTS `order_ids`',
      'DROP TABLE IF EXISTS `we``ird`',
      'DROP PROCEDURE IF EXISTS `refresh`',
      'DROP EVENT IF EXISTS `nightly`',
    ]);
  });
});

describe('mysqlLockName', () => {
  it("fits GET_LOCK's 64-character limit for any database name", () => {
    expect(mysqlLockName('x'.repeat(200)).length).toBeLessThanOrEqual(64);
  });

  it('gives different databases different locks', () => {
    expect(mysqlLockName('shop')).not.toBe(mysqlLockName('blog'));
  });
});

describe('mysqlSslArgs', () => {
  it('adds nothing when no mode is set', () => {
    expect(mysqlSslArgs(undefined, false)).toEqual([]);
    expect(mysqlSslArgs(undefined, true)).toEqual([]);
  });

  it('uses --ssl-mode for the MySQL client', () => {
    expect(mysqlSslArgs('require', false)).toEqual(['--ssl-mode=REQUIRED']);
    expect(mysqlSslArgs('disable', false)).toEqual(['--ssl-mode=DISABLED']);
    expect(mysqlSslArgs('verify-full', false)).toEqual([
      '--ssl-mode=VERIFY_IDENTITY',
    ]);
  });

  it('uses --ssl flags for the MariaDB client', () => {
    expect(mysqlSslArgs('require', true)).toEqual([
      '--ssl',
      '--skip-ssl-verify-server-cert',
    ]);
    expect(mysqlSslArgs('disable', true)).toEqual(['--skip-ssl']);
  });
});

describe('lockDatabase', () => {
  it('rejects engines it cannot lock', async () => {
    await expect(
      lockDatabase({
        database: { type: 'redis' },
        storage: { provider: 'local' },
      }),
    ).rejects.toThrow(/not supported for "redis"/);
  });

  it('needs a database name for MySQL', async () => {
    await expect(
      lockDatabase({
        database: { type: 'mysql' },
        storage: { provider: 'local' },
      }),
    ).rejects.toThrow(/database name is required/);
  });
});
