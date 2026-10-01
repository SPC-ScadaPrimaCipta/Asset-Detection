import { NextRequest, NextResponse } from 'next/server';
import { getTuning } from '@/lib/tuning';

async function scanGeminiModels(apiKey: string) {
  const { geminiBaseUrl, listTimeoutMs } = (await getTuning()).model;
  try {
    const res = await fetch(`${geminiBaseUrl}/v1/models?key=${apiKey}`, {
      signal: AbortSignal.timeout(listTimeoutMs),
    });
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

    // Gemini doesn't expose quota via API, show placeholder info
    const quota = {
      balance: 'N/A',
      granted: null,
      toppedUp: null,
      currency: 'USD',
      info: 'Gemini quota tracked per-API-key in Google Cloud Console'
    };

    return { valid: true, models, quota };
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Scan failed', models: [], quota: null };
  }
}

async function scanDeepSeekModels(apiKey: string) {
  const { deepseekBaseUrl, listTimeoutMs } = (await getTuning()).model;
  try {
    const res = await fetch(`${deepseekBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(listTimeoutMs),
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
      const balRes = await fetch(`${deepseekBaseUrl}/user/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(listTimeoutMs),
      });
      if (balRes.ok) {
        const balData = await balRes.json() as any;
        if (balData && balData.is_available !== undefined) {
           const info = balData.balance_infos?.[0];
           quota = {
             balance: info?.total_balance || '0.00',
             granted: info?.granted_balance || '0.00',
             toppedUp: info?.topped_up_balance || '0.00',
             currency: info?.currency || 'CNY'
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
