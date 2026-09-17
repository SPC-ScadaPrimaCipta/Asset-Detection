import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export async function GET() {
  try {
    const result = await pool.query('SELECT ai_provider, gemini_model FROM settings WHERE id = 1');
    const settings = result.rows[0] || { ai_provider: 'gemini', gemini_model: 'gemini-2.0-flash' };
    return NextResponse.json(settings);
  } catch (err) {
    console.error('Settings fetch failed:', err);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { ai_provider, gemini_api_key, deepseek_api_key, gemini_model } = await req.json();

    if (!['gemini', 'deepseek'].includes(ai_provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIdx = 1;

    if (ai_provider) {
      updates.push(`ai_provider = $${paramIdx++}`);
      values.push(ai_provider);
    }
    if (gemini_api_key !== undefined) {
      updates.push(`gemini_api_key = $${paramIdx++}`);
      values.push(gemini_api_key || null);
    }
    if (deepseek_api_key !== undefined) {
      updates.push(`deepseek_api_key = $${paramIdx++}`);
      values.push(deepseek_api_key || null);
    }
    if (gemini_model) {
      updates.push(`gemini_model = $${paramIdx++}`);
      values.push(gemini_model);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(null); // placeholder

    if (updates.length <= 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const query = `UPDATE settings SET ${updates.join(', ')} WHERE id = 1 RETURNING ai_provider, gemini_model`;
    const result = await pool.query(query, values.slice(0, -1));

    return NextResponse.json(result.rows[0]);
  } catch (err: unknown) {
    console.error('Settings update failed:', err);
    const msg = err instanceof Error ? err.message : 'Update failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
