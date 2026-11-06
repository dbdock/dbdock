import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface DetectedMigration {
  tool: 'prisma' | 'drizzle';
  command: string[];
  // The file that gave the tool away, shown so the user can check the guess.
  source: string;
}

const DRIZZLE_CONFIGS = [
  'drizzle.config.ts',
  'drizzle.config.js',
  'drizzle.config.mjs',
  'drizzle.config.cjs',
  'drizzle.config.json',
];

function packageDependencies(cwd: string): Set<string> {
  const path = join(cwd, 'package.json');
  if (!existsSync(path)) return new Set();
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function detectPrisma(cwd: string, deps: Set<string>): string | null {
  if (existsSync(join(cwd, 'prisma', 'schema.prisma')))
    return 'prisma/schema.prisma';
  if (existsSync(join(cwd, 'schema.prisma'))) return 'schema.prisma';
  return deps.has('prisma') ? 'package.json' : null;
}

function detectDrizzle(cwd: string, deps: Set<string>): string | null {
  const config = DRIZZLE_CONFIGS.find((name) => existsSync(join(cwd, name)));
  if (config) return config;
  return deps.has('drizzle-kit') ? 'package.json' : null;
}

// The deploy command of the migration tool this project uses, or null when
// none is found. Throws when both are found, rather than guess.
export function detectMigration(cwd: string): DetectedMigration | null {
  const deps = packageDependencies(cwd);
  const prisma = detectPrisma(cwd, deps);
  const drizzle = detectDrizzle(cwd, deps);
  if (prisma && drizzle)
    throw new Error(
      `Found both Prisma (${prisma}) and Drizzle (${drizzle}). Say which one to run: npx dbdock run -- npx prisma migrate deploy, or npx dbdock run -- npx drizzle-kit migrate.`,
    );
  if (prisma)
    return {
      tool: 'prisma',
      command: ['npx', 'prisma', 'migrate', 'deploy'],
      source: prisma,
    };
  if (drizzle)
    return {
      tool: 'drizzle',
      command: ['npx', 'drizzle-kit', 'migrate'],
      source: drizzle,
    };
  return null;
}
