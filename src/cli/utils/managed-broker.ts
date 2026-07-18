import { CLIConfig } from './config';
import { ManagedBroker } from '../../cloud/types';
import { requireSession } from '../../cloud/session';

export function isManagedStorage(config: CLIConfig): boolean {
  return config.storage.provider === 'managed';
}

export async function getManagedBroker(
  config: CLIConfig,
): Promise<ManagedBroker> {
  const session = await requireSession(config.storage.managed?.profile);
  return session.client;
}
