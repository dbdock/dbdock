import { ApiError, NetworkError } from './api-client';

function bodyMessage(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    if (Array.isArray(message) && typeof message[0] === 'string') {
      return message.join(', ');
    }
  }
  return null;
}

export function formatCloudError(err: unknown): string {
  if (err instanceof NetworkError) {
    return 'Could not reach DBDock Cloud. Check your internet connection and try again.';
  }

  if (err instanceof ApiError) {
    const detail = bodyMessage(err.body);
    switch (err.status) {
      case 401:
        return 'Your session has expired. Run `dbdock login` to sign in again.';
      case 403:
        return (
          detail ??
          'This feature is not available on your current plan. Upgrade at https://dbdock.xyz/billing.'
        );
      case 404:
        return detail ?? 'Not found.';
      case 409:
        return (
          detail ?? 'That conflicts with the current state. Refresh and retry.'
        );
      case 413:
        return (
          detail ??
          'This would exceed your storage quota. Free up space or upgrade your plan.'
        );
      case 429:
        return 'You are being rate limited. Wait a moment and try again.';
      default:
        if (err.status >= 500) {
          return 'DBDock Cloud had a problem handling that. Please try again shortly.';
        }
        return detail ?? `Request failed (HTTP ${err.status}).`;
    }
  }

  return err instanceof Error ? err.message : String(err);
}
