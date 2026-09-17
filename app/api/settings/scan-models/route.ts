import { NextRequest, NextResponse } from 'next/server';

async function scanGeminiModels(apiKey: string) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error?.message || 'Invalid API key');
    }
    const data = await res.json() as { models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }> };
    const models = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name,
      }));
    return { valid: true, models, quota: null };
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Scan failed', models: [], quota: null };
  }
}

async function scanDeepSeekModels(apiKey: string) {
  try {
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error?.message || 'Invalid API key');
    }
    const data = await res.json() as { data?: Array<{ id: string; object?: string }> };
    const models = (data.data || [])
      .filter(m => m.object === 'model')
      .map(m => ({ id: m.id, name: m.id }));

    // Try to get balance
    let quota = null;
    try {
      const balRes = await fetch('https://api.deepseek.com/user/balance', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (balRes.ok) {
        const balData = await balRes.json() as any;
        if (balData && balData.is_available !== undefined) {
           quota = {
             balance: balData.balance_infos?.[0]?.total_balance || '0.00',
             currency: balData.balance_infos?.[0]?.currency || 'CNY'
           };
        }
      }
    } catch(e) {}

    return { valid: true, models, quota };
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Scan failed', models: [], quota: null };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { provider, api_key } = await req.json() as { provider: 'gemini' | 'deepseek'; api_key: string };

    if (!api_key?.trim()) {
      return NextResponse.json({ error: 'API key required' }, { status: 400 });
    }

    let result;
    if (provider === 'gemini') {
      result = await scanGeminiModels(api_key.trim());
    } else if (provider === 'deepseek') {
      result = await scanDeepSeekModels(api_key.trim());
    } else {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('Model scan failed:', err);
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
  }
}
