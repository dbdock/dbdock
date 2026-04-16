import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PermissionsCheckResult {
  secure: boolean;
  currentMode: string;
  recommendedMode: string;
  warning?: string;
}

export function checkFilePermissions(filePath: string): PermissionsCheckResult {
  if (os.platform() === 'win32') {
    return {
      secure: true,
      currentMode: 'N/A (Windows)',
      recommendedMode: 'N/A (Windows)',
    };
  }

  try {
    const stats = fs.statSync(filePath);
    const mode = stats.mode;

    const ownerRead = (mode & 0o400) !== 0;
    const ownerWrite = (mode & 0o200) !== 0;
    const groupRead = (mode & 0o040) !== 0;
    const groupWrite = (mode & 0o020) !== 0;
    const otherRead = (mode & 0o004) !== 0;
    const otherWrite = (mode & 0o002) !== 0;

    const modeString = (mode & 0o777).toString(8).padStart(3, '0');

    const isWorldReadable = otherRead;
    const isGroupReadable = groupRead;
    const hasWriteByOthers = otherWrite || groupWrite;

    const secure = !isWorldReadable && !hasWriteByOthers;

    let warning: string | undefined;
    if (isWorldReadable) {
      warning =
        'Config file is world-readable. Anyone on this system can read your secrets.';
    } else if (hasWriteByOthers) {
      warning =
        'Config file is writable by group or others. This could allow unauthorized modifications.';
    } else if (isGroupReadable) {
      warning = 'Config file is readable by group members.';
    }

    return {
      secure,
      currentMode: modeString,
      recommendedMode: '600',
      warning,
    };
  } catch (error) {
    return {
      secure: true,
      currentMode: 'unknown',
      recommendedMode: '600',
    };
  }
}

export function isFileWorldReadable(filePath: string): boolean {
  if (os.platform() === 'win32') {
    return false;
  }

  try {
    const stats = fs.statSync(filePath);
    return (stats.mode & 0o004) !== 0;
  } catch {
    return false;
  }
}

export function suggestPermissionsFix(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  return `chmod 600 "${absolutePath}"`;
}

export function checkDirectoryPermissions(
  dirPath: string,
): PermissionsCheckResult {
  if (os.platform() === 'win32') {
    return {
      secure: true,
      currentMode: 'N/A (Windows)',
      recommendedMode: 'N/A (Windows)',
    };
  }

  try {
    const stats = fs.statSync(dirPath);
    const mode = stats.mode;

    const modeString = (mode & 0o777).toString(8).padStart(3, '0');

    const otherRead = (mode & 0o004) !== 0;
    const otherWrite = (mode & 0o002) !== 0;
    const otherExecute = (mode & 0o001) !== 0;

    const secure = !otherWrite;

    return {
      secure,
      currentMode: modeString,
      recommendedMode: '700',
      warning: otherWrite ? 'Directory is writable by others' : undefined,
    };
  } catch {
    return {
      secure: true,
      currentMode: 'unknown',
      recommendedMode: '700',
    };
  }
}
