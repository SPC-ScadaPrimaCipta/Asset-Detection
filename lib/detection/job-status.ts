/**
 * Detection job lifecycle states shared by the worker, the API routes, and tests.
 *
 * Kept in its own module because `workers/detection-worker.ts` has import side
 * effects (Redis connection, startup timers, job recovery), so anything that
 * needs these states — including tests — cannot import it.
 */

/**
 * States after which a detection job must not be processed again.
 *
 * A processor that reaches one of these states has already done its work, or the
 * user has decided its fate. Running it anyway is what produced duplicate
 * detections when BullMQ re-delivered a job whose lock had expired.
 */
export const TERMINAL_JOB_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'FAILED']);

/** True when a stored status means the job is finished, one way or another. */
export function isTerminalJobStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && TERMINAL_JOB_STATUSES.has(status);
}