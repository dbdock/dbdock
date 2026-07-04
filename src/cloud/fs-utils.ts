import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

export function ensureDir(dir: string, mode?: number): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode });
  }
}

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as T;
}

export function writeJsonFileAtomic(
  path: string,
  value: unknown,
  fileMode?: number,
): void {
  ensureDir(dirname(path));
  const tmp = join(
    dirname(path),
    `.${Date.now()}-${process.pid}.tmp`,
  );
  const data = JSON.stringify(value, null, 2) + '\n';
  writeFileSync(tmp, data, fileMode !== undefined ? { mode: fileMode } : {});
  renameSync(tmp, path);
}
