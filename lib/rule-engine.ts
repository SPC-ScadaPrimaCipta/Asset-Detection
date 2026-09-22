/**
 * Configurable Engineering Rule Engine
 *
 * Rules stored as JSON in rule_engine_rules table per asset_type.
 * Supports: required_rules, optional_rules, penalty_rules, bonus_rules.
 * New asset types can be added without code changes.
 */

import { pool } from '@/lib/db';

export interface RuleCondition {
  name: string;
  description: string;
  check: string;           // feature field to check, e.g. 'shape', 'has_actuator'
  expected: unknown;       // expected value or array of accepted values
}

export interface RuleSet {
  required: RuleCondition[];    // must pass all → fail = low confidence
  optional: RuleCondition[];    // nice to have → each pass adds small bonus
  penalty: Array<{              // if condition met → apply penalty
    condition: string;
    check: string;
    expected: unknown;
    penalty: number;            // e.g. -0.10 = -10%
    description: string;
  }>;
  bonus: Array<{                // if condition met → apply bonus
    condition: string;
    check: string;
    expected: unknown;
    bonus: number;              // e.g. +0.05 = +5%
    description: string;
  }>;
}

export interface RuleEvaluationResult {
  assetType: string;
  passed_required: number;
  total_required: number;
  passed_optional: number;
  total_optional: number;
  penalties_applied: number;
  bonuses_applied: number;
  net_adjustment: number;       // sum of penalties + bonuses
  rule_score: number;           // 0-1 based on required pass rate + adjustments
  reasons: string[];
}

// In-memory cache for rule sets (DB-backed, refreshed periodically)
let ruleCache: Map<string, RuleSet> = new Map();
let ruleCacheAt = 0;
const RULE_CACHE_TTL_MS = 60_000;

async function loadRules(): Promise<void> {
  if (Date.now() - ruleCacheAt < RULE_CACHE_TTL_MS) return;
  const rows = await pool.query('SELECT asset_type, rules FROM rule_engine_rules');
  ruleCache = new Map(rows.rows.map(r => [
    r.asset_type.toLowerCase(),
    typeof r.rules === 'string' ? JSON.parse(r.rules) : r.rules,
  ]));
  ruleCacheAt = Date.now();
}

export function clearRuleCache(): void {
  ruleCacheAt = 0;
}

/**
 * Get rule set for an asset type.
 * Falls back to generic rules if specific type not found.
 */
export async function getRules(assetType: string): Promise<RuleSet | null> {
  await loadRules();
  return ruleCache.get(assetType.toLowerCase()) ?? ruleCache.get('generic') ?? null;
}

/**
 * Evaluate detected symbol features against rules for an asset type.
 * Returns evaluation result including score and reasons.
 *
 * @param assetType    candidate asset type
 * @param features     detected symbol features (from feature extractor or partial)
 */
export async function evaluateRules(
  assetType: string,
  features: Record<string, unknown>
): Promise<RuleEvaluationResult> {
  const rules = await getRules(assetType);
  const reasons: string[] = [];

  if (!rules) {
    return {
      assetType,
      passed_required: 0,
      total_required: 0,
      passed_optional: 0,
      total_optional: 0,
      penalties_applied: 0,
      bonuses_applied: 0,
      net_adjustment: 0,
      rule_score: 0.5, // neutral when no rules defined
      reasons: ['No rules defined for this asset type — neutral score applied'],
    };
  }

  // Helper: check if a feature value matches expected
  function matches(check: string, expected: unknown): boolean {
    const actual = features[check];
    if (actual === undefined || actual === null) return false;
    if (Array.isArray(expected)) return expected.includes(actual);
    return String(actual).toLowerCase() === String(expected).toLowerCase();
  }

  // Required rules
  let passedRequired = 0;
  for (const rule of rules.required) {
    if (matches(rule.check, rule.expected)) {
      passedRequired++;
      reasons.push(`✓ Required: ${rule.description}`);
    } else {
      reasons.push(`✗ Required FAILED: ${rule.description} (expected ${rule.expected}, got ${features[rule.check] ?? 'null'})`);
    }
  }

  // Optional rules
  let passedOptional = 0;
  for (const rule of rules.optional) {
    if (matches(rule.check, rule.expected)) {
      passedOptional++;
      reasons.push(`✓ Optional: ${rule.description}`);
    }
  }

  // Penalty rules
  let totalPenalty = 0;
  let penaltiesApplied = 0;
  for (const rule of rules.penalty) {
    if (matches(rule.check, rule.expected)) {
      totalPenalty += rule.penalty;
      penaltiesApplied++;
      reasons.push(`⚠ Penalty (${(rule.penalty * 100).toFixed(0)}%): ${rule.description}`);
    }
  }

  // Bonus rules
  let totalBonus = 0;
  let bonusesApplied = 0;
  for (const rule of rules.bonus) {
    if (matches(rule.check, rule.expected)) {
      totalBonus += rule.bonus;
      bonusesApplied++;
      reasons.push(`★ Bonus (+${(rule.bonus * 100).toFixed(0)}%): ${rule.description}`);
    }
  }

  // Score: required pass rate as base, adjust with net penalty/bonus
  const requiredBase = rules.required.length > 0
    ? passedRequired / rules.required.length
    : 0.5;
  const optionalBonus = rules.optional.length > 0
    ? (passedOptional / rules.optional.length) * 0.1  // optional adds up to 10%
    : 0;

  const netAdjustment = totalBonus + totalPenalty;
  const ruleScore = Math.max(0, Math.min(1, requiredBase + optionalBonus + netAdjustment));

  return {
    assetType,
    passed_required: passedRequired,
    total_required: rules.required.length,
    passed_optional: passedOptional,
    total_optional: rules.optional.length,
    penalties_applied: penaltiesApplied,
    bonuses_applied: bonusesApplied,
    net_adjustment: parseFloat(netAdjustment.toFixed(4)),
    rule_score: parseFloat(ruleScore.toFixed(4)),
    reasons,
  };
}

/**
 * Save or update rules for an asset type.
 * Upserts: creates if not exists, updates if exists.
 */
export async function saveRules(assetType: string, rules: RuleSet): Promise<void> {
  await pool.query(
    `INSERT INTO rule_engine_rules (asset_type, rules)
     VALUES ($1, $2)
     ON CONFLICT (asset_type) DO UPDATE SET rules=$2, updated_at=NOW()`,
    [assetType.toLowerCase(), JSON.stringify(rules)]
  );
  clearRuleCache();
}

/**
 * List all rule definitions.
 */
export async function listRules(): Promise<Array<{ asset_type: string; rules: RuleSet; updated_at: string }>> {
  const rows = await pool.query('SELECT asset_type, rules, updated_at FROM rule_engine_rules ORDER BY asset_type');
  return rows.rows.map(r => ({
    asset_type: r.asset_type,
    rules: typeof r.rules === 'string' ? JSON.parse(r.rules) : r.rules,
    updated_at: r.updated_at,
  }));
}
