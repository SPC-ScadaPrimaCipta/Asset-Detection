/**
 * Stage 3 — Legend semantic class grouping (pure functions, no I/O).
 *
 * Rules (locked, conservative):
 * - Candidate grouping key = normalized Legend Description ONLY
 *   (`normalizeLegendLabel` from legend-model.ts — single implementation).
 * - "GATE VALVE" vs "ACTUATED GATE VALVE" NEVER merge (different keys).
 * - Visual similarity NEVER merges labels (no image input here at all).
 * - Asset Tag NEVER participates (no tag field exists in this module).
 * - Eligibility is DERIVED, never stored as a tunable flag:
 *     eligible = quality_status === 'validated' AND cropReadable === true
 *   review / rejected / missing are never auto-eligible.
 */
import { normalizeLegendLabel } from '@/lib/detection/legend/legend-model';

export interface ClassCandidateInput {
  id: string;
  symbol_name?: string | null;
  asset_type?: string | null;
}

export interface ClassCandidate {
  /** Normalized description — the candidate class key ( = Asset Type). */
  key: string;
  /** Verbatim label of first-seen member (display). */
  label: string;
  symbolIds: string[];
}

export function groupLegendClasses(
  symbols: ClassCandidateInput[]
): ClassCandidate[] {
  const order: string[] = [];
  const groups = new Map<string, ClassCandidate>();
  for (const s of symbols) {
    const raw = (s.symbol_name ?? s.asset_type ?? '').trim();
    if (!raw) continue; // unlabeled symbols form no class (honest skip)
    const key = normalizeLegendLabel(raw);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { key, label: raw, symbolIds: [] };
      groups.set(key, g);
      order.push(key);
    }
    if (!g.symbolIds.includes(s.id)) g.symbolIds.push(s.id);
  }
  return order.map((k) => groups.get(k)!);
}

export type QualityStatus = 'validated' | 'review' | 'rejected' | null;

export interface EligibilityInput {
  quality_status?: string | null;
  cropReadable: boolean;
}

export function isMatcherEligible(input: EligibilityInput): {
  eligible: boolean;
  reason: string;
} {
  if (!input.cropReadable) {
    return { eligible: false, reason: 'missing crop file' };
  }
  if (input.quality_status === 'validated') {
    return { eligible: true, reason: 'validated + crop readable' };
  }
  if (input.quality_status === 'review') {
    return { eligible: false, reason: 'review is not auto-eligible' };
  }
  if (input.quality_status === 'rejected') {
    return { eligible: false, reason: 'rejected is never eligible' };
  }
  return { eligible: false, reason: 'not yet assessed' };
}
