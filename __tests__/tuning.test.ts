/**
 * Tuning merge rules.
 *
 * The contract this protects: a literal in code is a LAST resort. Overrides must
 * win from DB, then env, then code — and a malformed override must never
 * propagate NaN/undefined into the detection pipeline, because a NaN confidence
 * silently corrupts every downstream decision.
 */
import { buildTuning, num, bool, str, strList, clearTuningCache } from '@/lib/tuning';
import { env } from '@/lib/env';

describe('scalar coercion helpers', () => {
  it('num accepts finite numbers', () => {
    expect(num(0.7, 0.1)).toBe(0.7);
    expect(num(0, 0.1)).toBe(0);
    expect(num(-3, 0.1)).toBe(-3);
  });

  it('num parses numeric strings (JSONB override arrives as text sometimes)', () => {
    expect(num('0.85', 0.1)).toBe(0.85);
  });

  it('num falls back on NaN, Infinity, null, undefined and junk', () => {
    expect(num(NaN, 0.1)).toBe(0.1);
    expect(num(Infinity, 0.1)).toBe(0.1);
    expect(num(null, 0.1)).toBe(0.1);
    expect(num(undefined, 0.1)).toBe(0.1);
    expect(num('abc', 0.1)).toBe(0.1);
    expect(num('', 0.1)).toBe(0.1);
  });

  it('bool accepts real booleans and the string forms a form may submit', () => {
    expect(bool(true, false)).toBe(true);
    expect(bool(false, true)).toBe(false);
    expect(bool('true', false)).toBe(true);
    expect(bool('1', false)).toBe(true);
    expect(bool('false', true)).toBe(false);
    expect(bool('0', true)).toBe(false);
    expect(bool('yes', true)).toBe(true); // unrecognised → fallback
  });

  it('str ignores blank values so a cleared field falls back', () => {
    expect(str('gemini-x', 'y')).toBe('gemini-x');
    expect(str('', 'y')).toBe('y');
    expect(str('   ', 'y')).toBe('y');
    expect(str(42, 'y')).toBe('y');
  });

  it('strList parses a comma list and trims', () => {
    expect(strList('a, b ,c', [])).toEqual(['a', 'b', 'c']);
  });

  it('strList accepts a real array', () => {
    expect(strList(['a', ' b '], [])).toEqual(['a', 'b']);
  });

  it('strList falls back when empty so a bad override cannot wipe the list', () => {
    expect(strList('', ['keep'])).toEqual(['keep']);
    expect(strList('  ,  ', ['keep'])).toEqual(['keep']);
    expect(strList([], ['keep'])).toEqual(['keep']);
  });
});

describe('buildTuning — env layer', () => {
  it('produces the env-derived values with no overrides', () => {
    const t = buildTuning();
    expect(t.detection.reviewThreshold).toBe(env.DETECTION_REVIEW_THRESHOLD);
    expect(t.generation.gemini.temperature).toBe(env.GEMINI_TEMPERATURE);
    expect(t.generation.gemini.maxOutputTokens).toBe(env.GEMINI_MAX_OUTPUT_TOKENS);
    expect(t.validator.confidenceThreshold).toBe(env.VALIDATOR_CONFIDENCE_THRESHOLD);
    expect(t.regions.mode).toBe(env.DETECTION_REGION_MODE);
  });

  it('derives the preferred model list from the env comma list', () => {
    const t = buildTuning();
    expect(t.model.preferred.length).toBeGreaterThan(0);
    expect(t.model.preferred).not.toContain('');
  });

  it('lowercases the JSON-incompatible model set for case-insensitive matching', () => {
    const t = buildTuning();
    for (const m of t.model.jsonIncompatible) {
      expect(m).toBe(m.toLowerCase());
    }
  });

  it('strips a trailing slash from provider base URLs', () => {
    const t = buildTuning({ model: { geminiBaseUrl: 'https://proxy.example.com/' } });
    expect(t.model.geminiBaseUrl).toBe('https://proxy.example.com');
  });
});

describe('buildTuning — DB override layer wins over env', () => {
  it('overrides a scalar threshold', () => {
    const t = buildTuning({ detection: { reviewThreshold: 0.9 } });
    expect(t.detection.reviewThreshold).toBe(0.9);
  });

  it('overrides a nested generation value', () => {
    const t = buildTuning({ generation: { gemini: { temperature: 0.2 } } });
    expect(t.generation.gemini.temperature).toBe(0.2);
  });

  it('overrides the region mode', () => {
    expect(buildTuning({ regions: { mode: 'page' } }).regions.mode).toBe('page');
  });

  it('overrides booleans', () => {
    const t = buildTuning({ regions: { catchup: false } });
    expect(t.regions.catchup).toBe(false);
  });

  it('overrides list values', () => {
    const t = buildTuning({ model: { preferred: ['my-model-a', 'my-model-b'] } });
    expect(t.model.preferred).toEqual(['my-model-a', 'my-model-b']);
  });

  it('overrides only the given key and leaves siblings at env values', () => {
    const t = buildTuning({ detection: { reviewThreshold: 0.9 } });
    expect(t.detection.reviewThreshold).toBe(0.9);
    expect(t.detection.penaltyNoTag).toBe(env.DETECTION_PENALTY_NO_TAG);
    expect(t.detection.nmsIouThreshold).toBe(env.NMS_IOU_THRESHOLD);
  });

  it('overrides nested symbolFeatures booleans independently', () => {
    const t = buildTuning({ detection: { symbolFeatures: { extract: true } } });
    expect(t.detection.symbolFeatures.extract).toBe(true);
    expect(t.detection.symbolFeatures.embed).toBe(env.ENABLE_SYMBOL_EMBEDDING === 'true');
  });

  it('overrides fusion weights', () => {
    const t = buildTuning({ fusion: { weights: { legend: 0.7, vision: 0.1 } } });
    expect(t.fusion.weights.legend).toBe(0.7);
    expect(t.fusion.weights.vision).toBe(0.1);
    expect(t.fusion.weights.company).toBe(0.20);
  });

  it('overrides the fallback-chain circuit breaker and attempt cap', () => {
    const t = buildTuning({
      model: { maxModelAttempts: 5, circuitFailures: 7, circuitCooldownMs: 60_000 },
    });
    expect(t.model.maxModelAttempts).toBe(5);
    expect(t.model.circuitFailures).toBe(7);
    expect(t.model.circuitCooldownMs).toBe(60_000);
  });

  it('overrides the shared requests-per-minute ceiling', () => {
    expect(buildTuning({ model: { requestsPerMinute: 60 } }).model.requestsPerMinute).toBe(60);
  });

  it('falls back to env for the requests-per-minute ceiling', () => {
    expect(buildTuning({}).model.requestsPerMinute).toBe(env.GEMINI_REQUESTS_PER_MINUTE);
  });

  it('overrides the BullMQ lock settings', () => {
    const t = buildTuning({
      performance: {
        workerConcurrency: 4,
        workerLockDurationMs: 1_200_000,
        workerLockRenewTimeMs: 60_000,
        workerStalledIntervalMs: 90_000,
        workerMaxStalledCount: 2,
      },
    });
    expect(t.performance.workerConcurrency).toBe(4);
    expect(t.performance.workerLockDurationMs).toBe(1_200_000);
    expect(t.performance.workerLockRenewTimeMs).toBe(60_000);
    expect(t.performance.workerStalledIntervalMs).toBe(90_000);
    expect(t.performance.workerMaxStalledCount).toBe(2);
  });

  it('falls back to env for the new knobs when not overridden', () => {
    const t = buildTuning({});
    expect(t.model.maxModelAttempts).toBe(env.GEMINI_MAX_MODEL_ATTEMPTS);
    expect(t.model.circuitFailures).toBe(env.GEMINI_CIRCUIT_FAILURES);
    expect(t.model.circuitCooldownMs).toBe(env.GEMINI_CIRCUIT_COOLDOWN_MS);
    expect(t.performance.workerLockDurationMs).toBe(env.WORKER_LOCK_DURATION_MS);
    expect(t.performance.workerConcurrency).toBe(env.WORKER_CONCURRENCY);
  });

  it('rejects non-positive lock values from the DB (an unsafe override is ignored)', () => {
    // lockDuration <= 0 would make BullMQ throw at Worker construction, so the
    // env fallback has to win over a bad DB value.
    const t = buildTuning({ performance: { workerLockDurationMs: 0 } } as never);
    expect(t.performance.workerLockDurationMs).toBe(env.WORKER_LOCK_DURATION_MS);
  });
});

describe('buildTuning — malformed overrides never poison the pipeline', () => {
  it('ignores wrong-typed scalars and keeps the env value', () => {
    const t = buildTuning({ detection: { reviewThreshold: 'not-a-number' } } as never);
    expect(t.detection.reviewThreshold).toBe(env.DETECTION_REVIEW_THRESHOLD);
  });

  it('ignores NaN supplied as a number', () => {
    const t = buildTuning({ detection: { reviewThreshold: NaN } } as never);
    expect(Number.isFinite(t.detection.reviewThreshold)).toBe(true);
  });

  it('ignores an unknown region mode', () => {
    expect(buildTuning({ regions: { mode: 'sideways' } } as never).regions.mode).toBe(
      env.DETECTION_REGION_MODE,
    );
  });

  it('ignores unknown keys entirely', () => {
    const t = buildTuning({
      nonsense: { a: 1 },
      detection: { notARealKey: 5, reviewThreshold: 0.88 },
    } as never);
    expect(t.detection.reviewThreshold).toBe(0.88);
    expect((t.detection as unknown as Record<string, unknown>).notARealKey).toBeUndefined();
  });

  it('survives a non-object override document', () => {
    expect(() => buildTuning('garbage' as never)).not.toThrow();
    expect(() => buildTuning(null as never)).not.toThrow();
    expect(() => buildTuning([] as never)).not.toThrow();
  });

  it('survives a nested group that is not an object', () => {
    expect(() => buildTuning({ generation: { gemini: 'nope' } } as never)).not.toThrow();
    const t = buildTuning({ generation: { gemini: 'nope' } } as never);
    expect(t.generation.gemini.temperature).toBe(env.GEMINI_TEMPERATURE);
  });

  it('never yields a non-finite confidence threshold', () => {
    for (const bad of ['x', null, NaN, Infinity, {}, []]) {
      const t = buildTuning({ detection: { reviewThreshold: bad } } as never);
      expect(Number.isFinite(t.detection.reviewThreshold)).toBe(true);
      expect(t.detection.reviewThreshold).toBeGreaterThanOrEqual(0);
      expect(t.detection.reviewThreshold).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildTuning — pageBatchSize tri-state', () => {
  it('is null when nothing is configured, so the worker derives it', () => {
    // PAGE_BATCH_SIZE is optional in the schema and unset in tests.
    if (env.PAGE_BATCH_SIZE === undefined) {
      expect(buildTuning().detection.pageBatchSize).toBeNull();
    }
  });

  it('honours an explicit override', () => {
    expect(buildTuning({ detection: { pageBatchSize: 4 } }).detection.pageBatchSize).toBe(4);
  });
});

describe('clearTuningCache', () => {
  it('is callable and does not throw', () => {
    expect(() => clearTuningCache()).not.toThrow();
  });
});
