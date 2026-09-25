/**
 * Detection V2 — confidence client (Node → Python CV service).
 * Single engine implementation is Python; this is a typed transport with
 * graceful degradation (null when unreachable).
 */
import { detectionConfig } from '@/lib/detection/config';
import type { ConfidenceOutput, ConfidenceRequest } from '@/lib/detection/scoring/confidence-model';

export async function cvConfidence(
  req: ConfidenceRequest,
  timeoutMs = 30_000
): Promise<ConfidenceOutput | null> {
  if (!req.candidateId) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${detectionConfig.cvServiceUrl}/confidence/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as ConfidenceOutput;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
