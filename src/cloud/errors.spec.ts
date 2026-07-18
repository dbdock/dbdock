import { ApiError, NetworkError } from './api-client';
import { formatCloudError } from './errors';

describe('formatCloudError', () => {
  it('explains network failures', () => {
    expect(formatCloudError(new NetworkError('boom'))).toMatch(
      /Could not reach DBDock Cloud/i,
    );
  });

  it('maps 401 to a login hint', () => {
    expect(formatCloudError(new ApiError(401, 'x', null))).toMatch(
      /dbdock login/i,
    );
  });

  it('prefers a server-provided message for 403', () => {
    expect(
      formatCloudError(
        new ApiError(403, 'x', { message: 'Pro plan required' }),
      ),
    ).toBe('Pro plan required');
  });

  it('falls back to an upgrade hint for a bare 403', () => {
    expect(formatCloudError(new ApiError(403, 'x', null))).toMatch(/plan/i);
  });

  it('explains quota (413)', () => {
    expect(formatCloudError(new ApiError(413, 'x', null))).toMatch(/quota/i);
  });

  it('joins array validation messages', () => {
    expect(
      formatCloudError(
        new ApiError(400, 'x', { message: ['name is required', 'bad type'] }),
      ),
    ).toBe('name is required, bad type');
  });

  it('hides 5xx internals', () => {
    expect(
      formatCloudError(new ApiError(503, 'x', { message: 'stack' })),
    ).toMatch(/had a problem/i);
  });

  it('passes through plain errors', () => {
    expect(formatCloudError(new Error('nope'))).toBe('nope');
  });
});
