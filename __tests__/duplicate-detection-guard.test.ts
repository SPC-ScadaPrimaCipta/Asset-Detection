/**
 * Regression tests for the duplicate-detection failure mode.
 *
 * Symptom these lock down: a job whose processing outlasted BullMQ's lock was
 * declared stalled and re-queued, and the second runner appended a second copy
 * of every detection for every page (two `start` blocks, ~89 rows for one page,
 * `Missing lock ... moveToFinished` at the end).
 *
 * Three independent layers have to hold for that to stay fixed:
 *   1. page persistence is idempotent (delete-then-insert),
 *   2. a processor that sees a terminal job does nothing,
 *   3. the fallback chain is bounded by a circuit breaker and an attempt cap.
 */
import {
  deleteDetectionsForPage,
  persistDetections,
  type DbLike,
  type PersistContext,
  type PersistableDetection,
} from '@/lib/detection/persistence/detection-repository';
import {
  ModelCircuitBreaker,
  isProviderUnavailable,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '@/lib/ai-circuit-breaker';
import {
  TERMINAL_JOB_STATUSES,
  isTerminalJobStatus,
} from '@/lib/detection/job-status';

interface Recorded {
  text: string;
  params: unknown[];
}

/**
 * Minimal in-memory stand-in that records every statement, so tests can assert
 * on the SQL the repository emits without a live database.
 */
function fakeDb(rows: Record<string, unknown>[] = []): DbLike & {
  calls: Recorded[];
  inserts: number;
} {
  const calls: Recorded[] = [];
  return {
    calls,
    get inserts() {
      return calls.filter((c) => c.text.startsWith('INSERT INTO detections')).length;
    },
    async query(text: string, params: unknown[]) {
      calls.push({ text, params });
      return { rows };
    },
  };
}

function detection(overrides: Partial<PersistableDetection> = {}): PersistableDetection {
  return {
    assetTag: 'P-101',
    assetType: 'Pump',
    confidence: 0.9,
    bbox: { x: 10, y: 20, width: 30, height: 40 },
    evidence: ['test'],
    ...overrides,
  } as PersistableDetection;
}

const ctx: PersistContext = {
  jobId: 'job-1',
  docId: 'doc-1',
  filename: 'P&ID-001.pdf',
  effectiveLegendId: null,
  legendSymbols: [],
  nullThreshold: 0.5,
};

describe('page persistence is idempotent', () => {
  it('deletes only this job\'s rows for this page', async () => {
    const db = fakeDb();
    await deleteDetectionsForPage(db, 'job-1', 3);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].text).toBe('DELETE FROM detections WHERE job_id = $1 AND pid_page = $2');
    // job_id + pid_page scoping: a re-run must never touch another page of the
    // same job, nor any other job's detections.
    expect(db.calls[0].params).toEqual(['job-1', 3]);
  });

  it('re-running a page replaces rows instead of appending them', async () => {
    const db = fakeDb();

    // First run of page 2.
    await deleteDetectionsForPage(db, 'job-1', 2);
    await persistDetections(db, [detection(), detection({ assetTag: 'V-101' })], ctx, 2);
    expect(db.inserts).toBe(2);

    // Second run of the same page (stalled job re-delivered).
    await deleteDetectionsForPage(db, 'job-1', 2);
    await persistDetections(db, [detection()], ctx, 2);

    // Each detection is an INSERT plus a dual-write UPDATE, so the meaningful
    // sequence is delete, insert, insert, delete, insert — the second DELETE
    // lands between the runs, never after the final insert.
    const seq: Array<'delete' | 'insert'> = [];
    for (const call of db.calls) {
      if (call.text.startsWith('DELETE')) seq.push('delete');
      else if (call.text.startsWith('INSERT')) seq.push('insert');
    }

    expect(seq).toEqual(['delete', 'insert', 'insert', 'delete', 'insert']);
  });

  it('keeps a page-1 re-run from touching page 2', async () => {
    const db = fakeDb();
    await deleteDetectionsForPage(db, 'job-1', 1);

    const deleteParams = db.calls[0].params;
    expect(deleteParams[1]).toBe(1);
    expect(deleteParams[1]).not.toBe(2);
  });
});

describe('terminal job statuses', () => {
  it('covers the states after which a processor must not work again', () => {
    // These are the exact states the worker's claim query excludes.
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual(['CANCELLED', 'COMPLETED', 'FAILED']);
  });

  it('does not treat PENDING or PROCESSING as terminal', () => {
    // A PENDING job is exactly what a stalled re-queue produces — the duplicate
    // runner must still be allowed to process it, otherwise the job is lost.
    expect(TERMINAL_JOB_STATUSES.has('PENDING')).toBe(false);
    expect(TERMINAL_JOB_STATUSES.has('PROCESSING')).toBe(false);
  });

  it('isTerminalJobStatus handles null and undefined', () => {
    expect(isTerminalJobStatus('COMPLETED')).toBe(true);
    expect(isTerminalJobStatus('CANCELLED')).toBe(true);
    expect(isTerminalJobStatus('FAILED')).toBe(true);
    expect(isTerminalJobStatus('PENDING')).toBe(false);
    expect(isTerminalJobStatus('PROCESSING')).toBe(false);
    expect(isTerminalJobStatus(null)).toBe(false);
    expect(isTerminalJobStatus(undefined)).toBe(false);
  });
});

describe('isProviderUnavailable', () => {
  it.each([
    '503 Service Unavailable: This model is currently experiencing high demand',
    '429 Resource has been exhausted (e.g. check quota)',
    'Error fetching from https://...:generateContent: [404 Not Found]',
    'fetch failed',
    'socket hang up',
    'ETIMEDOUT',
    'model gemini-x is not found for API version v1beta',
  ])('treats %s as a provider outage', (msg) => {
    expect(isProviderUnavailable(msg)).toBe(true);
  });

  it.each([
    'Schema validation failed: detections.0.assetType — expected string',
    'Response was not valid JSON: unexpected token }',
    'All Gemini models exhausted',
    'GEMINI_API_KEY not configured',
  ])('does not treat %s as a provider outage', (msg) => {
    // These mean the model answered. Opening the breaker on them would exclude
    // a working model purely because it disagreed about output shape.
    expect(isProviderUnavailable(msg)).toBe(false);
  });
});

describe('ModelCircuitBreaker', () => {
  it('is disabled when the threshold or cooldown is zero', () => {
    expect(new ModelCircuitBreaker({ failureThreshold: 0, cooldownMs: 1000 }).enabled).toBe(false);
    expect(new ModelCircuitBreaker({ failureThreshold: 3, cooldownMs: 0 }).enabled).toBe(false);
    const b = new ModelCircuitBreaker({ failureThreshold: 0, cooldownMs: 1000 });
    b.recordFailure('m');
    expect(b.isOpen('m')).toBe(false);
  });

  it('stays closed below the threshold', () => {
    const b = new ModelCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    b.recordFailure('m');
    b.recordFailure('m');
    expect(b.isOpen('m')).toBe(false);
  });

  it('opens at the threshold and tracks each model separately', () => {
    const b = new ModelCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) b.recordFailure('bad');
    b.recordFailure('other');
    b.recordFailure('other');

    expect(b.isOpen('bad')).toBe(true);
    // A different model's failures must not open 'bad' back up or vice versa.
    expect(b.isOpen('other')).toBe(false);
    expect(b.openModels()).toEqual(['bad']);
  });

  it('clears the streak on a success so an intermittent model is not sidelined', () => {
    const b = new ModelCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    b.recordFailure('m');
    b.recordFailure('m');
    b.recordSuccess('m');
    b.recordFailure('m');
    b.recordFailure('m');
    expect(b.isOpen('m')).toBe(false);
  });

  it('reopens the model once the cooldown elapses', () => {
    let clock = 1000;
    const b = new ModelCircuitBreaker({ failureThreshold: 2, cooldownMs: 500 }, () => clock);
    b.recordFailure('m');
    b.recordFailure('m');
    expect(b.isOpen('m')).toBe(true);

    clock = 1499;
    expect(b.isOpen('m')).toBe(true);
    clock = 1500;
    expect(b.isOpen('m')).toBe(false);
    // Half-open reset: a single post-cooldown failure must not re-trip at once.
    b.recordFailure('m');
    expect(b.isOpen('m')).toBe(false);
  });

  it('ignores a success for a model it has never seen', () => {
    const b = new ModelCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    expect(() => b.recordSuccess('unknown')).not.toThrow();
    expect(b.isOpen('unknown')).toBe(false);
  });

  it('defaults to a usable config when constructed empty', () => {
    const b = new ModelCircuitBreaker();
    expect(b.enabled).toBe(true);
    for (let i = 0; i < DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
      b.recordFailure('m');
    }
    expect(b.isOpen('m')).toBe(true);
  });
});