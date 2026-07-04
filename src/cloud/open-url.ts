import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { defaultAppBaseUrl } from './constants';

export function buildDashboardUrl(
  projectId: string,
  organizationId?: string | null,
  appBaseUrl: string = defaultAppBaseUrl(),
): string {
  const base = appBaseUrl.replace(/\/+$/, '');
  if (organizationId) {
    return `${base}/orgs/${organizationId}/projects/${projectId}`;
  }
  return `${base}/projects/${projectId}`;
}

export function isWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME) {
    return true;
  }
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf-8'));
  } catch {
    return false;
  }
}

export function openerCommand(): { cmd: string; args: string[] } {
  if (process.platform === 'darwin') {
    return { cmd: 'open', args: [] };
  }
  if (process.platform === 'win32') {
    return { cmd: 'cmd.exe', args: ['/c', 'start', ''] };
  }
  if (isWsl()) {
    return { cmd: 'wslview', args: [] };
  }
  return { cmd: 'xdg-open', args: [] };
}

export function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { cmd, args } = openerCommand();
    const child = spawn(cmd, [...args, url], {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
