/**
 * Shared minimum-interval gate for outbound Gemini requests.
 *
 * The 429s in region sweeps are not caused by any single call being too large —
 * they are caused by issuing more requests per minute than the quota allows. A
 * 4x4 legend grid plus a catch-up pass is 17 requests; detection regions are 5
 * per page. At the free tier's 15 requests/minute those cannot all fit in a
 * minute, so whatever per-loop delay happens to be configured, some requests
 * are guaranteed to be rejected.
 *
 * The per-loop delays (`DETECTION_REGION_DELAY_MS`, `LEGEND_REGION_DELAY_MS`)
 * only help if they happen to be set high enough, and they are applied between
 * loops rather than to the provider as a whole. This gate enforces the rate
 * limit in one place, across every Gemini call in the process, so:
 *
 *   - detection and legend extraction share one budget instead of each having
 *     its own idea of how fast it may go,
 *   - concurrent page batches cannot multiply the request rate,
 *   - a rejected request is prevented rather than retried.
 *
 * It is intentionally process-local: it smooths the request rate within one
 * worker, which is the only thing needed to stay under a per-minute quota.
 */

export class RequestGate {
  private nextAllowedAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get intervalMs(): number {
    return this.minIntervalMs;
  }

  /** True when the gate would impose no delay at all. */
  get disabled(): boolean {
    return this.minIntervalMs <= 0;
  }

  /**
   * Wait until this request is allowed to go out.
   *
   * Callers are serialized through `chain` rather than each independently
   * sleeping, so N concurrent callers are spaced N intervals apart instead of
   * all waking at once and bursting.
   */
  async wait(): Promise<void> {
    if (this.disabled) return;

    const run = this.chain.then(async () => {
      const now = this.now();
      const waitMs = this.nextAllowedAt - now;
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
      this.nextAllowedAt = this.now() + this.minIntervalMs;
    });

    // Keep the chain alive even if one link rejects, so a single failure does
    // not permanently deadlock the gate.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Delay after a provider rate-limit rejection.
   *
   * The gate only knows the configured ceiling; a 429 means the real quota is
   * tighter than that (a shared key, a lower tier, or another consumer). Backing
   * off pushes the next attempt far enough out that it has a chance of landing
   * in the next window.
   */
  async backoff(factorMs: number): Promise<void> {
    if (this.disabled || factorMs <= 0) return;
    this.nextAllowedAt = this.now() + Math.max(this.minIntervalMs, factorMs);
    await this.wait();
  }
}

let sharedGate: RequestGate | null = null;
let sharedGateKey = 0;

/**
 * Process-wide gate, recreated when the configured rate changes.
 *
 * Both `lib/ai-agent.ts` (detection) and `lib/legend-extract.ts` (legend
 * extraction) resolve the same instance, so the two features consume one
 * request budget.
 */
export function getSharedGeminiGate(requestsPerMinute: number): RequestGate {
  const rpm = Number.isFinite(requestsPerMinute) ? Math.max(1, Math.floor(requestsPerMinute)) : 15;
  const interval = Math.round(60_000 / rpm);
  if (!sharedGate || sharedGateKey !== interval) {
    sharedGate = new RequestGate(interval);
    sharedGateKey = interval;
  }
  return sharedGate;
}

/** Drop the shared gate (tests). */
export function resetSharedGeminiGate(): void {
  sharedGate = null;
  sharedGateKey = 0;
}