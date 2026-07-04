import { LocalState, PendingJob } from './types';

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
export const DEFAULT_MAX_ATTEMPTS = 8;

// Exponential backoff with full jitter, capped.
export function computeBackoff(attempts: number): number {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

export function enqueue(state: LocalState, job: PendingJob): LocalState {
  return { ...state, pending: [...state.pending, job] };
}

export function dueJobs(
  state: LocalState,
  now: number = Date.now(),
): PendingJob[] {
  return state.pending.filter(
    (job) => new Date(job.nextAttemptAt).getTime() <= now,
  );
}

export function markAcked(state: LocalState, jobId: string): LocalState {
  return { ...state, pending: state.pending.filter((j) => j.id !== jobId) };
}

export function markFailed(
  state: LocalState,
  jobId: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  now: number = Date.now(),
): LocalState {
  const job = state.pending.find((j) => j.id === jobId);
  if (!job) {
    return state;
  }
  const attempts = job.attempts + 1;
  const pending = state.pending.filter((j) => j.id !== jobId);

  if (attempts >= maxAttempts) {
    return {
      ...state,
      pending,
      deadletter: [...state.deadletter, { ...job, attempts }],
    };
  }

  const nextAttemptAt = new Date(now + computeBackoff(attempts)).toISOString();
  return {
    ...state,
    pending: [...pending, { ...job, attempts, nextAttemptAt }],
  };
}
