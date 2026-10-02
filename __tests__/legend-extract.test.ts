/**
 * Robust legend ingestion: truncated-JSON salvage, retry backoff,
 * bbox sanitation, chunk offset math, and dedupe. No network calls —
 * Gemini transport is bypassed by testing pure helpers + injected fakes.
 */
import {
  callWithRetry,
  dedupeSymbols,
  extractLegendSymbolsRobust,
  isChainUnavailable,
  offsetChunkBbox,
  parseRetryDelayMs,
  salvageSymbols,
  sanitizeBbox,
  type ParsedSymbol,
} from '@/lib/legend-extract';
import { ModelCircuitBreaker } from '@/lib/ai-circuit-breaker';
const sym = (over: Partial<ParsedSymbol> = {}): ParsedSymbol => ({
  asset_type: 'Valve',
  symbol_name: 'GATE VALVE',
  tag_pattern: null,
  description: null,
  aliases: [],
  bbox_x: 100,
  bbox_y: 100,
  bbox_w: 50,
  bbox_h: 50,
  ...over,
});

describe('salvageSymbols (truncated maxOutputTokens output)', () => {
  it('recovers complete objects and skips the cut-off tail', () => {
    const text = '{"symbols":[{"name":"GATE VALVE","assetType":"Valve","bbox":[10,20,60,80]},{"name":"PUMP","assetType":"Pump","bbox":[100,200,150,260]},{"name":"BROKEN","assetType":"Tan';
    const out = salvageSymbols(text);
    expect(out).toHaveLength(2);
    expect((out[0] as any).name).toBe('GATE VALVE');
    expect((out[1] as any).name).toBe('PUMP');
  });

  it('handles code fences and clean arrays', () => {
    const text = '```json\n{"symbols":[{"name":"A"}]}\n```';
    expect(salvageSymbols(text)).toHaveLength(1);
  });

  it('returns [] when nothing parseable', () => {
    expect(salvageSymbols('no json here')).toEqual([]);
    expect(salvageSymbols('{"symbols":[{broken')).toEqual([]);
  });

  it('ignores braces inside strings', () => {
    const text = '{"symbols":[{"name":"A } B { C","assetType":"Valve"}]}';
    const out = salvageSymbols(text);
    expect(out).toHaveLength(1);
    expect((out[0] as any).name).toBe('A } B { C');
  });
});

describe('parseRetryDelayMs', () => {
  it('reads RetryInfo seconds', () => {
    expect(parseRetryDelayMs('... "retryDelay":"32s" ...', 2000)).toBe(32000);
  });

  it('falls back on garbage', () => {
    expect(parseRetryDelayMs('quota exceeded', 2000)).toBe(2000);
    expect(parseRetryDelayMs('retryDelay":"999999s"', 2000)).toBe(2000);
  });
});

describe('callWithRetry', () => {
  it('returns first-try success without sleeping', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const out = await callWithRetry(async () => 42, { sleep });
    expect(out).toBe(42);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries 429/503 then succeeds', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    let n = 0;
    const out = await callWithRetry(
      async () => {
        n++;
        if (n < 3) throw new Error('[429 Too Many Requests] quota');
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 100, sleep, label: 't' }
    );
    expect(out).toBe('ok');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable errors', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(
      callWithRetry(async () => { throw new Error('INVALID_API_KEY bad key'); }, { sleep })
    ).rejects.toThrow('INVALID_API_KEY');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after maxAttempts', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(
      callWithRetry(async () => { throw new Error('[503 Service Unavailable] busy'); }, { maxAttempts: 2, baseDelayMs: 10, sleep })
    ).rejects.toThrow('503');
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe('sanitizeBbox', () => {
  it('clamps out-of-range values into 0-1000', () => {
    // y=2000 clamps to 999, which squeezes height to 1000-999=1
    expect(sanitizeBbox({ x: -5, y: 2000, w: 50, h: 60 })).toEqual({ x: 0, y: 999, w: 50, h: 1 });
  });

  it('rejects non-finite and null', () => {
    expect(sanitizeBbox({ x: NaN, y: 0, w: 1, h: 1 })).toBeNull();
    expect(sanitizeBbox({ x: null, y: 0, w: 1, h: 1 })).toBeNull();
  });
});

describe('offsetChunkBbox', () => {
  it('maps chunk-local coords back to page coords', () => {
    // Left half chunk {x:0,w:550}: local (100,200,50,50) → page (55,200,27,50)
    const out = offsetChunkBbox({ x: 100, y: 200, w: 50, h: 50 }, { x: 0, y: 0, width: 550, height: 1000 });
    expect(out).toEqual({ x: 55, y: 200, w: 28, h: 50 });
  });
});

describe('dedupeSymbols', () => {
  it('merges same-name overlapping boxes from chunk overlap strips', () => {
    const a = sym({ symbol_name: 'GATE VALVE', bbox_x: 480, bbox_y: 100, bbox_w: 40, bbox_h: 40 });
    const b = sym({ symbol_name: 'gate valve', bbox_x: 482, bbox_y: 102, bbox_w: 40, bbox_h: 40 });
    const c = sym({ symbol_name: 'PUMP', bbox_x: 480, bbox_y: 100, bbox_w: 40, bbox_h: 40 });
    const out = dedupeSymbols([a, b, c]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.symbol_name)).toEqual(['GATE VALVE', 'PUMP']);
  });

  it('keeps same-name symbols at different locations', () => {
    const a = sym({ symbol_name: 'VALVE', bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20 });
    const b = sym({ symbol_name: 'VALVE', bbox_x: 500, bbox_y: 500, bbox_w: 20, bbox_h: 20 });
    expect(dedupeSymbols([a, b])).toHaveLength(2);
  });

  it('keeps bbox-less symbols (never drops evidence blindly)', () => {
    expect(dedupeSymbols([sym({ bbox_x: null })])).toHaveLength(1);
  });
});

describe('isChainUnavailable (fail-fast on a provider outage)', () => {
  const CANDIDATES = ['gemini-a', 'gemini-b', 'gemini-c'];

  it('false while at least one model can still be used', () => {
    const breaker = new ModelCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    breaker.recordFailure('gemini-a');
    expect(isChainUnavailable(CANDIDATES, new Set(), breaker)).toBe(false);
  });

  it('true once every candidate has an open circuit', () => {
    const breaker = new ModelCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    for (const m of CANDIDATES) breaker.recordFailure(m);
    expect(isChainUnavailable(CANDIDATES, new Set(), breaker)).toBe(true);
    expect(breaker.openModels()).toEqual(CANDIDATES);
  });

  it('true when all candidates are json-incompatible, even with no failures', () => {
    const breaker = new ModelCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    expect(isChainUnavailable(CANDIDATES, new Set(CANDIDATES), breaker)).toBe(true);
  });

  it('recovers after the cooldown expires', () => {
    let now = 1_000;
    const breaker = new ModelCircuitBreaker(
      { failureThreshold: 1, cooldownMs: 500 },
      () => now,
    );
    for (const m of CANDIDATES) breaker.recordFailure(m);
    expect(isChainUnavailable(CANDIDATES, new Set(), breaker)).toBe(true);
    now += 501;
    expect(isChainUnavailable(CANDIDATES, new Set(), breaker)).toBe(false);
  });
});

describe('extractLegendSymbolsRobust (injected fakes — no network)', () => {
  it('uses full page when it succeeds (1 call, no chunking)', async () => {
    const fake = jest.fn().mockResolvedValue([sym()]);
    const crop = jest.fn();
    const r = await extractLegendSymbolsRobust('FULLPAGE', 1, crop, fake);
    expect(r.strategy).toBe('full');
    expect(r.symbols).toHaveLength(1);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(crop).not.toHaveBeenCalled();
  });

  it('falls back to chunks on full-page failure, offsets bboxes, dedupes', async () => {
    // Same physical symbol sits in the 450-550 overlap strip, so both chunks
    // see it: left-local x=909 → page 500; right-local x=91 → page 500.
    const left = sym({ symbol_name: 'GATE VALVE', bbox_x: 909, bbox_y: 100, bbox_w: 40, bbox_h: 40 });
    const right = sym({ symbol_name: 'gate valve', bbox_x: 91, bbox_y: 100, bbox_w: 40, bbox_h: 40 });
    const fake = jest.fn().mockImplementation(async (b64: string) => {
      if (b64 === 'FULLPAGE') throw new Error('[503 Service Unavailable] busy');
      if (b64 === 'CHUNK-L') return [left];
      if (b64 === 'CHUNK-R') return [right];
      return [];
    });
    const crop = jest.fn().mockImplementation(async (_b: string, box: { x: number }) =>
      box.x === 0 ? 'CHUNK-L' : 'CHUNK-R'
    );
    const r = await extractLegendSymbolsRobust('FULLPAGE', 1, crop, fake);
    expect(r.strategy).toBe('chunked');
    // Both chunks saw the overlap-strip symbol → deduped to 1,
    // with bbox mapped back to page coordinates (909 in left chunk → 500).
    expect(r.symbols).toHaveLength(1);
    expect(r.symbols[0].bbox_x).toBe(500);
  });

  it('throws when full page and all chunks fail', async () => {
    const fake = jest.fn().mockRejectedValue(new Error('[503] down'));
    await expect(
      extractLegendSymbolsRobust('FULLPAGE', 1, jest.fn().mockResolvedValue(null), fake)
    ).rejects.toThrow();
  });

  it('throws when everything returns empty', async () => {
    const fake = jest.fn().mockResolvedValue([]);
    await expect(
      extractLegendSymbolsRobust('FULLPAGE', 1, jest.fn().mockResolvedValue('C'), fake)
    ).rejects.toThrow();
  });
});
