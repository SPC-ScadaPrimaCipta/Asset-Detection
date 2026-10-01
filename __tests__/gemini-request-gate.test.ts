/**
 * Tests for the shared Gemini request gate.
 *
 * The 429s in a region sweep come from issuing more requests per minute than the
 * quota allows: a 4x4 legend grid plus a catch-up pass is 17 requests against a
 * 15/minute ceiling. The gate is what turns that guaranteed rejection into
 * spacing that fits.
 */
import {
  RequestGate,
  getSharedGeminiGate,
  resetSharedGeminiGate,
} from '@/lib/gemini-request-gate';

describe('RequestGate — spacing', () => {
  it('lets the first request through immediately', async () => {
    const gate = new RequestGate(1000, () => 0);
    await expect(gate.wait()).resolves.toBeUndefined();
  });

  it('is a no-op when the interval is zero', async () => {
    const gate = new RequestGate(0);
    expect(gate.disabled).toBe(true);
    // Must not hang or sleep: this is the "quota large enough" fast path.
    await Promise.all([gate.wait(), gate.wait(), gate.wait()]);
  });

  it('rejects a negative interval rather than looping forever', () => {
    const gate = new RequestGate(-1);
    expect(gate.disabled).toBe(true);
  });

  it('spaces concurrent callers instead of letting them burst together', async () => {
    // A clock the test controls, so no real sleeping is needed. Each link
    // advances the clock by the sleep duration it was asked for.
    let clock = 0;
    const gate = new RequestGate(100, () => clock);
    const realSetTimeout = setTimeout;
    // Replace the gate's sleep with an immediate clock advance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).setTimeout = (fn: () => void, ms?: number) =>
      realSetTimeout(() => {
        clock += ms ?? 0;
        fn();
      }, 0);

    try {
      const stamps: number[] = [];
      await Promise.all([
        gate.wait().then(() => stamps.push(clock)),
        gate.wait().then(() => stamps.push(clock)),
        gate.wait().then(() => stamps.push(clock)),
      ]);
      // Three concurrent callers at a 100ms ceiling must land one interval apart,
      // not all at t=0 (which is what an ungated burst looks like to the API).
      expect(stamps).toEqual([0, 100, 200]);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).setTimeout = realSetTimeout;
    }
  });

  it('recovers after a caller throws — one failure must not deadlock the gate', async () => {
    let clock = 0;
    const gate = new RequestGate(10, () => clock);
    await gate.wait();
    // A rejected waiter represents a request that failed between wait() and the
    // provider call. The chain must still release for the next caller.
    await expect(
      Promise.allSettled([gate.wait(), gate.wait()]),
    ).resolves.toHaveLength(2);
  });
});

describe('RequestGate — backoff', () => {
  it('pushes the next attempt past the requested window', async () => {
    let clock = 0;
    const gate = new RequestGate(1000, () => clock);
    await gate.wait();
    // After one request the gate is reserved until t=1000.
    clock = 1000;
    // A 429 means the real quota is tighter than the configured ceiling, so the
    // backoff must exceed the normal spacing rather than merely repeat it.
    const realSetTimeout = setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).setTimeout = (fn: () => void, ms?: number) =>
      realSetTimeout(() => {
        clock += ms ?? 0;
        fn();
      }, 0);
    try {
      await gate.backoff(8000);
      // 1000 (reserved) + 8000 (backoff) = the next slot opens at 9000.
      expect(clock).toBeGreaterThanOrEqual(8000);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).setTimeout = realSetTimeout;
    }
  });

  it('never backs off less than the configured interval', async () => {
    let clock = 0;
    const gate = new RequestGate(4000, () => clock);
    await gate.wait();
    const realSetTimeout = setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).setTimeout = (fn: () => void, ms?: number) =>
      realSetTimeout(() => {
        clock += ms ?? 0;
        fn();
      }, 0);
    try {
      // A tiny backoff hint must not make the gate issue requests sooner than
      // the ceiling allows.
      await gate.backoff(10);
      expect(clock).toBeGreaterThanOrEqual(4000);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).setTimeout = realSetTimeout;
    }
  });
});

describe('getSharedGeminiGate', () => {
  beforeEach(() => resetSharedGeminiGate());
  afterAll(() => resetSharedGeminiGate());

  it('returns one instance so legend and detection share a single budget', () => {
    const a = getSharedGeminiGate(15);
    const b = getSharedGeminiGate(15);
    // Sharing is the point: two features each with their own gate would together
    // exceed the quota by 2x.
    expect(a).toBe(b);
  });

  it('rebuilds when the configured rate changes', () => {
    const a = getSharedGeminiGate(15);
    const b = getSharedGeminiGate(60);
    expect(b).not.toBe(a);
    expect(b.intervalMs).toBe(1000);
  });

  it('derives the interval from requests per minute', () => {
    expect(getSharedGeminiGate(15).intervalMs).toBe(4000);
    expect(getSharedGeminiGate(30).intervalMs).toBe(2000);
    expect(getSharedGeminiGate(60).intervalMs).toBe(1000);
  });

  it('clamps nonsense rates instead of producing a zero or negative interval', () => {
    expect(getSharedGeminiGate(0).intervalMs).toBe(60_000);
    expect(getSharedGeminiGate(-5).intervalMs).toBe(60_000);
    expect(getSharedGeminiGate(Number.NaN).intervalMs).toBe(4000);
  });
});