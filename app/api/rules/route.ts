/**
 * GET  /api/rules           — list all rule definitions
 * POST /api/rules           — create or update rules for an asset type
 *
 * Rules stored as JSON per asset_type in rule_engine_rules table.
 * New asset types can be added without code changes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listRules, saveRules, getRules, clearRuleCache } from '@/lib/rule-engine';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const assetType = searchParams.get('asset_type');

    if (assetType) {
      const rules = await getRules(assetType);
      if (!rules) {
        return NextResponse.json({ error: 'No rules defined for this asset type' }, { status: 404 });
      }
      return NextResponse.json({ asset_type: assetType, rules });
    }

    const all = await listRules();
    return NextResponse.json({ data: all, total: all.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[rules GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const assetType = body.asset_type as string | undefined;
    const rules = body.rules as Record<string, unknown> | undefined;

    if (!assetType || typeof assetType !== 'string' || !assetType.trim()) {
      return NextResponse.json({ error: 'asset_type is required' }, { status: 400 });
    }
    if (!rules || typeof rules !== 'object') {
      return NextResponse.json({ error: 'rules object is required' }, { status: 400 });
    }

    // Validate structure — required, optional, penalty, bonus arrays
    const requiredArrays = ['required', 'optional', 'penalty', 'bonus'];
    for (const k of requiredArrays) {
      if (rules[k] !== undefined && !Array.isArray(rules[k])) {
        return NextResponse.json(
          { error: `rules.${k} must be an array` },
          { status: 400 }
        );
      }
    }

    await saveRules(assetType.trim(), {
      required: (rules.required as never[]) ?? [],
      optional: (rules.optional as never[]) ?? [],
      penalty: (rules.penalty as never[]) ?? [],
      bonus: (rules.bonus as never[]) ?? [],
    });

    return NextResponse.json({ saved: true, asset_type: assetType.trim() }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[rules POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/rules?asset_type=...  — remove rule definition + clear cache
 */
export async function DELETE(request: NextRequest) {
  try {
    const assetType = request.nextUrl.searchParams.get('asset_type');
    if (!assetType) {
      return NextResponse.json({ error: 'asset_type query param required' }, { status: 400 });
    }

    const { pool } = await import('@/lib/db');
    await pool.query('DELETE FROM rule_engine_rules WHERE LOWER(asset_type) = LOWER($1)', [assetType]);
    clearRuleCache();

    return NextResponse.json({ deleted: true, asset_type: assetType });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[rules DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
