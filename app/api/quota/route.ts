import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

async function getDeepSeekQuota(apiKey: string) {
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const balData = await res.json() as any;
      if (balData && balData.is_available !== undefined) {
        const info = balData.balance_infos?.[0];
        return {
          balance: info?.total_balance || '0.00',
          granted: info?.granted_balance || '0.00',
          toppedUp: info?.topped_up_balance || '0.00',
          currency: info?.currency || 'CNY'
        };
      }
    }
  } catch(e) {}
  return null;
}

export async function GET() {
  try {
    const result = await pool.query('SELECT ai_provider, gemini_api_key, deepseek_api_key FROM settings WHERE id = 1');
    const row = result.rows[0];
    const provider = row?.ai_provider || 'gemini';

    let data = null;
    let message = `Active provider: ${provider}. Configure API keys in Settings to see quota.`;

    if (provider === 'deepseek' && row?.deepseek_api_key) {
       data = await getDeepSeekQuota(row.deepseek_api_key);
       message = data ? '' : 'Could not fetch DeepSeek balance.';
    } else if (provider === 'gemini') {
       message = 'Gemini quota must be tracked per-API-key via the Google Cloud Console.';
    }

    return NextResponse.json({ provider, data, message });
  } catch (err) {
    console.error('Quota fetch failed:', err);
    return NextResponse.json({ error: 'Failed to fetch quota' }, { status: 500 });
  }
}
