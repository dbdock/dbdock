import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCommand } from './run';

// With enabled: false, `dbdock run -- <command>` runs the command alone, which
// exercises starting a real child process without a database.
describe('dbdock run with DBDock turned off', () => {
  let cwd: string;
  let output: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dbdock-run-'));
    await writeFile(
      join(cwd, 'dbdock.config.mjs'),
      'export default { enabled: false };',
    );
    output = [];
    process.exitCode = undefined;
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    const capture = (...args: unknown[]) => output.push(args.join(' '));
    jest.spyOn(console, 'log').mockImplementation(capture);
    jest.spyOn(console, 'error').mockImplementation(capture);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
    await rm(cwd, { recursive: true, force: true });
  });

  const marker = () => join(cwd, 'ran.txt');

  it('runs the command without a checkpoint', async () => {
    await runCommand(
      [
        process.execPath,
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(marker())}, 'yes')`,
      ],
      {},
    );

    expect(existsSync(marker())).toBe(true);
    expect(output.join('\n')).toContain('DBDock is off');
    expect(process.exitCode).toBeUndefined();
  });

  it('fails when the command fails', async () => {
    await runCommand([process.execPath, '-e', 'process.exit(3)'], {});

    expect(process.exitCode).toBe(1);
    expect(output.join('\n')).toContain('Change command failed (3)');
  });

  it('fails when the command does not exist', async () => {
    await runCommand(['dbdock-test-no-such-command'], {});

    expect(process.exitCode).toBe(1);
    expect(output.join('\n')).toContain(
      'dbdock-test-no-such-command was not found',
    );
  });

  it('does not run SQL files', async () => {
    const sql = join(cwd, 'change.sql');
    await writeFile(sql, 'SELECT 1;');

    await runCommand([], { sql });

    expect(process.exitCode).toBe(1);
    expect(output.join('\n')).toContain('it does not run SQL files');
  });
});
