import {
  computeBackoff,
  DEFAULT_MAX_ATTEMPTS,
  dueJobs,
  enqueue,
  markAcked,
  markFailed,
} from './queue';
import { defaultLocalState } from './local-state';
import { PendingJob } from './types';

function makeJob(
  id: string,
  nextAttemptAt = '2000-01-01T00:00:00.000Z',
): PendingJob {
  return {
    id,
    idempotencyKey: 'k',
    baseRevision: 0,
    changes: [],
    events: [],
    attempts: 0,
    nextAttemptAt,
    createdAt: '2000-01-01T00:00:00.000Z',
  };
}

describe('queue', () => {
  it('enqueues and acks jobs', () => {
    let state = defaultLocalState('p');
    state = enqueue(state, makeJob('a'));
    expect(state.pending).toHaveLength(1);
    state = markAcked(state, 'a');
    expect(state.pending).toHaveLength(0);
  });

  it('returns only due jobs', () => {
    let state = defaultLocalState('p');
    state = enqueue(state, makeJob('a', '2000-01-01T00:00:00.000Z'));
    state = enqueue(state, makeJob('b', '3000-01-01T00:00:00.000Z'));
    const due = dueJobs(state, Date.parse('2500-01-01T00:00:00.000Z'));
    expect(due.map((j) => j.id)).toEqual(['a']);
  });

  it('increments attempts and backs off on failure', () => {
    let state = defaultLocalState('p');
    state = enqueue(state, makeJob('a'));
    state = markFailed(state, 'a', DEFAULT_MAX_ATTEMPTS, 1000);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].attempts).toBe(1);
    expect(new Date(state.pending[0].nextAttemptAt).getTime()).toBeGreaterThan(
      1000,
    );
  });

  it('moves a job to dead-letter at max attempts', () => {
    let state = defaultLocalState('p');
    state = enqueue(state, {
      ...makeJob('a'),
      attempts: DEFAULT_MAX_ATTEMPTS - 1,
    });
    state = markFailed(state, 'a', DEFAULT_MAX_ATTEMPTS, 1000);
    expect(state.pending).toHaveLength(0);
    expect(state.deadletter).toHaveLength(1);
  });

  it('computes bounded backoff', () => {
    expect(computeBackoff(0)).toBeGreaterThanOrEqual(0);
    expect(computeBackoff(20)).toBeLessThanOrEqual(60_000);
  });
});
