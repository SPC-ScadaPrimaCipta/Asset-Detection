/**
 * Per-model circuit breaker for the Gemini fallback chain.
 *
 * A Gemini outage does not fail a page cleanly — it fails *slowly*. Every model
 * in the chain is tried in turn, each failing with 503 after a network round
 * trip, each followed by an attempt delay. One page with a 2x2 grid plus a
 * catch-up pass is 5 requests, so a 5-model chain is up to 25 failed requests
 * and several minutes of wall clock, all while every call after the first two
 * is a request we already know will fail.
 *
 * The breaker records consecutive provider failures per model and skips a model
 * until its cooldown expires. It is deliberately process-local and unexported
 * state: it is a latency optimisation, not a correctness mechanism, so a worker
 * restart costing one retry round is an acceptable trade for no shared state to
 * keep consistent.
 *
 * Breaker trip conditions are limited to provider availability failures
 * (rate limits, 503, missing/retired models). Content-level failures — schema
 * validation, malformed JSON, empty detections — are NOT provider outages and
 * must not open the breaker, or a model that merely disagrees about output shape
 * would be excluded from the rest of the job.
 */

/** How many consecutive failures trip the breaker. 0 disables it. */
export interface CircuitBreakerConfig {
  /** Consecutive provider failures before the model is skipped. 0 = disabled. */
  failureThreshold: number;
  /** How long a tripped model is skipped for, in ms. */
  cooldownMs: number;
}

interface ModelState {
  consecutiveFailures: number;
  /** Epoch ms until which the model is skipped. 0 = not tripped. */
  openUntil: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 300_000,
};

/** Default matcher for "this failure means the provider/model is unavailable". */
const PROVIDER_UNAVAILABLE_RE =
  /429|quota|rate.limit|resource.?exhausted|503|unavailable|overloaded|not.found|no.longer.available|not.?found|404|invalid.*model|model.*not.*found|unknown.*model|does.*not.*exist|INVALID_ARGUMENT.*model|deadline.?exceeded|timeout|timed.?out|socket hang up|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i;

/**
 * True when an error message describes a provider-availability problem rather
 * than a problem with what the model returned.
 */
export function isProviderUnavailable(message: string): boolean {
  return PROVIDER_UNAVAILABLE_RE.test(message);
}

/**
 * Tracks per-model failure counts and cooldown windows.
 *
 * Exported as a class with an explicit `now()` injection so tests can advance
 * time without waiting.
 */
export class ModelCircuitBreaker {
  private readonly state = new Map<string, ModelState>();
  private readonly config: CircuitBreakerConfig;
  private readonly now: () => number;

  constructor(
    config: Partial<CircuitBreakerConfig> = {},
    now: () => number = Date.now,
  ) {
    this.config = {
      failureThreshold: Math.max(
        0,
        num(config.failureThreshold, DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold),
      ),
      cooldownMs: Math.max(
        0,
        num(config.cooldownMs, DEFAULT_CIRCUIT_BREAKER_CONFIG.cooldownMs),
      ),
    };
    this.now = now;
  }

  get enabled(): boolean {
    return this.config.failureThreshold > 0 && this.config.cooldownMs > 0;
  }

  /**
   * Whether the model should be skipped right now.
   *
   * A tripped breaker expires lazily: once the cooldown has passed the model is
   * allowed through again and its failure count is reset, so a model that
   * recovers is picked back up without a restart.
   */
  isOpen(model: string): boolean {
    if (!this.enabled) return false;
    const s = this.state.get(model);
    if (!s || s.openUntil === 0) return false;
    if (this.now() < s.openUntil) return true;
    // Cooldown elapsed: half-open. Clear the failure streak so the model is
    // tried cleanly rather than tripping again on its first single failure.
    s.openUntil = 0;
    s.consecutiveFailures = 0;
    return false;
  }

  /** Record a provider-level failure; trips the breaker at the threshold. */
  recordFailure(model: string): void {
    if (!this.enabled) return;
    const s = this.state.get(model) ?? { consecutiveFailures: 0, openUntil: 0 };
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.config.failureThreshold) {
      s.openUntil = this.now() + this.config.cooldownMs;
      s.consecutiveFailures = 0;
    }
    this.state.set(model, s);
  }

  /** Record a successful call, clearing any accumulated failures. */
  recordSuccess(model: string): void {
    if (!this.state.has(model)) return;
    const s = this.state.get(model)!;
    s.consecutiveFailures = 0;
    s.openUntil = 0;
  }

  /** Models currently skipped — for log lines and diagnostics. */
  openModels(): string[] {
    return [...this.state.entries()]
      .filter(([, s]) => s.openUntil > 0 && this.now() < s.openUntil)
      .map(([model]) => model);
  }

  /** Drop all state (tests). */
  reset(): void {
    this.state.clear();
  }
}

function num(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Process-wide breaker, recreated when the configured thresholds change.
 *
 * Shared by `lib/ai-agent.ts` (detection) and `lib/legend-extract.ts` (legend
 * extraction) because both talk to the same provider under the same quota: a
 * model that is returning 503 to detection is returning 503 to the legend
 * sweep, and each path learning that separately means paying for the failures
 * twice.
 */
let sharedBreaker: ModelCircuitBreaker | null = null;
let sharedBreakerKey = '';

export function getSharedModelBreaker(config: CircuitBreakerConfig): ModelCircuitBreaker {
  const key = `${config.failureThreshold}:${config.cooldownMs}`;
  if (!sharedBreaker || sharedBreakerKey !== key) {
    sharedBreaker = new ModelCircuitBreaker(config);
    sharedBreakerKey = key;
  }
  return sharedBreaker;
}

/** Drop the shared breaker (tests / manual recovery). */
export function resetSharedModelBreaker(): void {
  sharedBreaker?.reset();
  sharedBreaker = null;
  sharedBreakerKey = '';
}