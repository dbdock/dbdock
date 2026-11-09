import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { config as loadEnv } from 'dotenv';
import inquirer from 'inquirer';
import { findConfigFile } from '@/changes/config-file';
import { detectMigration } from '@/changes/detect';
import {
  KNOWN_TOOLS,
  WRAP,
  planScripts,
  unwrapScripts,
  type ScriptChange,
} from '@/changes/scripts';
import { CONFIG_FILE } from '@/cli/utils/config';
import { readProjectConfig } from '@/cloud/project-config';

interface InitOptions {
  yes?: boolean;
  remove?: boolean;
}

interface PackageJson {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// Scripts that usually run in CI or on a host, where local checkpoints are
// refused.
const DEPLOY_SCRIPT =
  /^(build|prebuild|postbuild|vercel-build|heroku-postbuild|postinstall|start|prestart|release|deploy)$|deploy|prod/;

function packageManager(cwd: string): {
  run: (script: string) => string;
  addDev: string;
} {
  if (existsSync(join(cwd, 'pnpm-lock.yaml')))
    return { run: (s) => `pnpm ${s}`, addDev: 'pnpm add -D dbdock' };
  if (existsSync(join(cwd, 'yarn.lock')))
    return { run: (s) => `yarn ${s}`, addDev: 'yarn add -D dbdock' };
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb')))
    return { run: (s) => `bun run ${s}`, addDev: 'bun add -d dbdock' };
  return {
    run: (s) => `npm run ${s}`,
    addDev: 'npm install --save-dev dbdock',
  };
}

function configFileContent(encryptionKnown: boolean): string {
  return `import { defineConfig } from 'dbdock/config';

// DBDock saves a checkpoint of your database before each migration the
// package.json scripts run through \`dbdock run --\`, keeps a record of it, and
// puts it back with \`npx dbdock undo\`.
export default defineConfig({
  // The database your migrations change.
  database: process.env.DATABASE_URL,

  // Where checkpoints are saved. In CI or on a host, local disk is refused:
  // use your own bucket there, e.g.
  // checkpoints: {
  //   storage: 's3',
  //   bucket: 'my-checkpoints',
  //   accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  // },
  checkpoints: { storage: 'local' },

  // Encrypts checkpoints. Keep a copy of the key: without it they cannot be
  // restored. Create one with:
  // node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ${encryptionKnown ? '' : '// '}encryptionKey: process.env.DBDOCK_ENCRYPTION_SECRET,

  // Set to false to run the scripts without DBDock, e.g. enabled: !process.env.CI
  enabled: true,
});
`;
}

function isTypeScriptProject(cwd: string, pkg: PackageJson): boolean {
  return (
    existsSync(join(cwd, 'tsconfig.json')) ||
    Boolean(pkg.dependencies?.typescript ?? pkg.devDependencies?.typescript)
  );
}

function printChanges(changes: ScriptChange[]): void {
  for (const change of changes) {
    console.log(`  ${change.script}`);
    console.log(`    before  ${change.before}`);
    console.log(`    after   ${change.after}`);
  }
}

async function confirm(message: string, yes?: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error(
      'Run again with --yes to make these changes. Nothing was changed.',
    );
    process.exitCode = 1;
    return false;
  }
  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    { type: 'confirm', name: 'proceed', default: true, message },
  ]);
  if (!proceed) console.log('Nothing was changed.');
  return proceed;
}

function writePackageJson(path: string, raw: string, pkg: PackageJson): void {
  const indent = /\n([ \t]+)"/.exec(raw)?.[1] ?? '  ';
  writeFileSync(
    path,
    JSON.stringify(pkg, null, indent) + (raw.endsWith('\n') ? '\n' : ''),
  );
}

// Sets a project up so its own migration scripts run through DBDock: wraps
// them in package.json and adds dbdock.config.ts. --remove takes DBDock back
// out of the scripts.
export async function projectInitCommand(
  options: InitOptions = {},
): Promise<void> {
  const cwd = process.cwd();
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(
      'Run npx dbdock init in your project folder, next to package.json. To set up scheduled backups instead: npx dbdock init --backups',
    );
    process.exitCode = 1;
    return;
  }
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as PackageJson;
  const scripts = pkg.scripts ?? {};
  const pm = packageManager(cwd);

  if (options.remove) {
    const changes = unwrapScripts(scripts);
    if (!changes.length) {
      console.log('No script runs through DBDock. Nothing to change.');
      return;
    }
    console.log('DBDock will take itself out of these scripts:');
    printChanges(changes);
    if (!(await confirm('Update package.json?', options.yes))) return;
    pkg.scripts = { ...scripts };
    for (const change of changes) pkg.scripts[change.script] = change.after;
    writePackageJson(pkgPath, raw, pkg);
    console.log('✓ Updated package.json');
    const configPath = findConfigFile(cwd);
    if (configPath)
      console.log(
        `  ${basename(configPath)} stays. Delete it if you no longer need it.`,
      );
    return;
  }

  const plan = planScripts(scripts);
  let added: { script: string; command: string } | undefined;
  if (!plan.changes.length && !plan.alreadyWrapped.length) {
    let detected: ReturnType<typeof detectMigration> = null;
    try {
      detected = detectMigration(cwd);
    } catch {
      detected = null;
    }
    const name = ['db:migrate', 'migrate', 'migrate:deploy'].find(
      (candidate) => !(candidate in scripts),
    );
    if (detected && name)
      added = {
        script: name,
        command: `${WRAP}${detected.command.filter((part) => part !== 'npx').join(' ')}`,
      };
  }
  const existingConfig =
    findConfigFile(cwd) ??
    (existsSync(join(cwd, CONFIG_FILE)) ? join(cwd, CONFIG_FILE) : null);
  const newConfig = existingConfig
    ? null
    : isTypeScriptProject(cwd, pkg)
      ? 'dbdock.config.ts'
      : 'dbdock.config.mjs';

  if (!plan.changes.length && !added && !newConfig) {
    console.log(
      plan.alreadyWrapped.length
        ? `Already set up: ${plan.alreadyWrapped.join(', ')} run through DBDock, and ${existingConfig} exists.`
        : 'Nothing to do.',
    );
    return;
  }

  console.log('DBDock will:');
  if (plan.changes.length) {
    console.log('- Run these scripts through DBDock:');
    printChanges(plan.changes);
  }
  if (added)
    console.log(
      `- Add a script that runs your migrations through DBDock:\n  ${added.script}   ${added.command}`,
    );
  if (newConfig) console.log(`- Create ${newConfig}`);
  if (!plan.changes.length && !added && !plan.alreadyWrapped.length)
    console.log(
      `\nNo script runs a migration tool DBDock knows (${KNOWN_TOOLS.join(', ')}).\nPut DBDock in front of yours by hand: "migrate": "${WRAP}<your command>"`,
    );
  for (const skip of plan.skipped)
    console.log(
      `\nNot changed: ${skip.script} (${skip.command})\n  ${skip.reason}`,
    );

  if (!(await confirm('Make these changes?', options.yes))) return;

  if (plan.changes.length || added) {
    pkg.scripts = { ...scripts };
    for (const change of plan.changes)
      pkg.scripts[change.script] = change.after;
    if (added) pkg.scripts[added.script] = added.command;
    writePackageJson(pkgPath, raw, pkg);
    console.log('✓ Updated package.json');
  }
  if (newConfig) {
    const fromDotenv: Record<string, string> = {};
    loadEnv({ path: join(cwd, '.env'), quiet: true, processEnv: fromDotenv });
    writeFileSync(
      join(cwd, newConfig),
      configFileContent(
        Boolean(
          process.env.DBDOCK_ENCRYPTION_SECRET ??
            fromDotenv.DBDOCK_ENCRYPTION_SECRET,
        ),
      ),
    );
    console.log(`✓ Created ${newConfig}`);
  }

  const wrapped = [
    ...plan.changes.map((change) => change.script),
    ...(added ? [added.script] : []),
  ];
  if (!pkg.dependencies?.dbdock && !pkg.devDependencies?.dbdock)
    console.log(
      `\nAdd DBDock to the project so the scripts and the config can find it:\n  ${pm.addDev}`,
    );
  const first = wrapped[0] ?? plan.alreadyWrapped[0];
  if (first)
    console.log(
      `\nNext: ${pm.run(first)}\nDBDock saves a checkpoint before the migration runs. To put it back: npx dbdock undo`,
    );
  const deploys = wrapped.filter((script) => DEPLOY_SCRIPT.test(script));
  if (deploys.length)
    console.log(
      `\n${deploys.join(', ')} usually run${deploys.length === 1 ? 's' : ''} in CI or on a host. There DBDock needs your own bucket (checkpoints in the config file), or it stops the script before the migration. Or turn it off there: enabled: !process.env.CI`,
    );
  if (!readProjectConfig(cwd)?.projectId)
    console.log(
      '\nTo see every change on dbdock.xyz: npx dbdock login, then npx dbdock link',
    );
}
