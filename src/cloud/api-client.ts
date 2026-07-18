import {
  Alert,
  AlertEvent,
  ChannelType,
  Entitlements,
  Identity,
  ManagedBroker,
  ManagedObject,
  ManagedPresignDownload,
  ManagedPresignUpload,
  ManagedStorageUsage,
  NotificationChannel,
  RemoteProject,
  RemoteState,
  SyncChange,
  SyncEvent,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | undefined>;
  retry?: boolean;
}

interface RawResponse<T> {
  status: number;
  data: T | null;
  etag: string | null;
}

const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 20_000;

export class ApiClient implements ManagedBroker {
  private readonly baseUrl: string;
  private readonly token: string | null;

  constructor(baseUrl: string, token: string | null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | undefined>,
  ): string {
    const url = new URL(
      `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
    );
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async request<T>(options: RequestOptions): Promise<RawResponse<T>> {
    const url = this.buildUrl(options.path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers ?? {}),
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    let payload: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(options.body);
    }

    const retryable = options.retry !== false;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < (retryable ? MAX_ATTEMPTS : 1); attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: options.method,
          headers,
          body: payload,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status >= 500 && retryable && attempt < MAX_ATTEMPTS - 1) {
          await sleep(backoff(attempt));
          continue;
        }

        const etag = res.headers.get('etag');
        const text = await res.text();
        const data = text ? (JSON.parse(text) as T) : null;

        if (res.status >= 400) {
          throw new ApiError(
            res.status,
            `Request failed (${res.status})`,
            data,
          );
        }
        return { status: res.status, data, etag };
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof ApiError) {
          throw err;
        }
        lastError = err as Error;
        if (retryable && attempt < MAX_ATTEMPTS - 1) {
          await sleep(backoff(attempt));
          continue;
        }
      }
    }
    throw new NetworkError(
      `Could not reach ${this.baseUrl}: ${lastError?.message ?? 'network error'}`,
    );
  }

  async me(): Promise<Identity> {
    const res = await this.request<Identity>({
      method: 'GET',
      path: '/auth/me',
    });
    return res.data as Identity;
  }

  async getEntitlements(): Promise<Entitlements> {
    const res = await this.request<Entitlements>({
      method: 'GET',
      path: '/billing/entitlements',
    });
    return res.data as Entitlements;
  }

  async getManagedUsage(): Promise<ManagedStorageUsage> {
    const res = await this.request<ManagedStorageUsage>({
      method: 'GET',
      path: '/storage-configs/managed/usage',
    });
    return res.data as ManagedStorageUsage;
  }

  async activateManagedStorage(): Promise<{ id: string | null }> {
    const res = await this.request<{ id: string | null }>({
      method: 'POST',
      path: '/storage-configs/managed/activate',
      retry: false,
    });
    return res.data as { id: string | null };
  }

  async presignUpload(input: {
    filename: string;
    size: number;
  }): Promise<ManagedPresignUpload> {
    const res = await this.request<ManagedPresignUpload>({
      method: 'POST',
      path: '/managed-storage/presign-upload',
      body: input,
      retry: false,
    });
    return res.data as ManagedPresignUpload;
  }

  async presignDownload(key: string): Promise<ManagedPresignDownload> {
    const res = await this.request<ManagedPresignDownload>({
      method: 'POST',
      path: '/managed-storage/presign-download',
      body: { key },
      retry: false,
    });
    return res.data as ManagedPresignDownload;
  }

  async listManagedObjects(): Promise<ManagedObject[]> {
    const res = await this.request<ManagedObject[]>({
      method: 'GET',
      path: '/managed-storage/objects',
    });
    return (res.data as ManagedObject[]) ?? [];
  }

  async deleteManagedObject(key: string): Promise<void> {
    await this.request({
      method: 'POST',
      path: '/managed-storage/delete',
      body: { key },
      retry: false,
    });
  }

  async listChannels(): Promise<NotificationChannel[]> {
    const res = await this.request<NotificationChannel[]>({
      method: 'GET',
      path: '/notification-channels',
    });
    return (res.data as NotificationChannel[]) ?? [];
  }

  async createChannel(body: {
    name: string;
    type: ChannelType;
    config: Record<string, unknown>;
  }): Promise<NotificationChannel> {
    const res = await this.request<NotificationChannel>({
      method: 'POST',
      path: '/notification-channels',
      body,
      retry: false,
    });
    return res.data as NotificationChannel;
  }

  async deleteChannel(id: string): Promise<void> {
    await this.request({
      method: 'DELETE',
      path: `/notification-channels/${id}`,
      retry: false,
    });
  }

  async testChannel(id: string): Promise<unknown> {
    const res = await this.request({
      method: 'POST',
      path: `/notification-channels/${id}/test`,
      retry: false,
    });
    return res.data;
  }

  async listAlerts(): Promise<Alert[]> {
    const res = await this.request<Alert[]>({
      method: 'GET',
      path: '/alerts',
    });
    return (res.data as Alert[]) ?? [];
  }

  async createAlert(body: {
    name: string;
    event: AlertEvent;
    channelId: string;
  }): Promise<Alert> {
    const res = await this.request<Alert>({
      method: 'POST',
      path: '/alerts',
      body,
      retry: false,
    });
    return res.data as Alert;
  }

  async deleteAlert(id: string): Promise<void> {
    await this.request({
      method: 'DELETE',
      path: `/alerts/${id}`,
      retry: false,
    });
  }

  async createProject(
    body: {
      name: string;
      slug?: string;
      organizationId?: string;
      publicId?: string;
    },
    idempotencyKey?: string,
  ): Promise<RemoteProject> {
    const res = await this.request<RemoteProject>({
      method: 'POST',
      path: '/projects',
      body,
      headers: idempotencyKey
        ? { 'Idempotency-Key': idempotencyKey }
        : undefined,
      retry: false,
    });
    return res.data as RemoteProject;
  }

  async getProject(ref: string): Promise<RemoteProject> {
    const res = await this.request<RemoteProject>({
      method: 'GET',
      path: `/projects/${ref}`,
    });
    return res.data as RemoteProject;
  }

  async getState(
    ref: string,
    etag?: string | null,
  ): Promise<RemoteState | null> {
    const res = await this.request<RemoteState>({
      method: 'GET',
      path: `/projects/${ref}/state`,
      headers: etag ? { 'If-None-Match': etag } : undefined,
    });
    if (res.status === 304) {
      return null;
    }
    return res.data as RemoteState;
  }

  async pushSync(
    ref: string,
    body: {
      baseRevision: number;
      clientStateHash?: string;
      changes: SyncChange[];
      events?: SyncEvent[];
    },
    idempotencyKey: string,
  ): Promise<{
    revision: number;
    stateHash: string;
    applied: number;
    resourceHashes: Record<string, string>;
  }> {
    const res = await this.request<{
      revision: number;
      stateHash: string;
      applied: number;
      resourceHashes: Record<string, string>;
    }>({
      method: 'POST',
      path: `/projects/${ref}/sync`,
      body,
      headers: {
        'Idempotency-Key': idempotencyKey,
        'If-Match': String(body.baseRevision),
      },
      retry: false,
    });
    return res.data as {
      revision: number;
      stateHash: string;
      applied: number;
      resourceHashes: Record<string, string>;
    };
  }

  async lock(
    ref: string,
    body: { operation?: string; holder?: string; ttlMs?: number },
  ): Promise<{ lockId: string; expiresAt: string }> {
    const res = await this.request<{ lockId: string; expiresAt: string }>({
      method: 'POST',
      path: `/projects/${ref}/lock`,
      body,
      retry: false,
    });
    return res.data as { lockId: string; expiresAt: string };
  }

  async unlock(
    ref: string,
    body: { lockId: string; force?: boolean },
  ): Promise<{ ok: boolean; forced: boolean }> {
    const res = await this.request<{ ok: boolean; forced: boolean }>({
      method: 'POST',
      path: `/projects/${ref}/unlock`,
      body,
      retry: false,
    });
    return res.data as { ok: boolean; forced: boolean };
  }
}

function backoff(attempt: number): number {
  const exp = Math.min(500 * 2 ** attempt, 8000);
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
