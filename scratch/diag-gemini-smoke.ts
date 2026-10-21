import 'dotenv/config';
import pool from '../lib/db';
import { getGeminiModel } from '../lib/gemini';
import { getTuning } from '../lib/tuning';

(async () => {
  const job = (await pool.query(
    "SELECT id,status,progress_pct,error_detail FROM detection_jobs ORDER BY created_at DESC LIMIT 1",
  )).rows[0];
  console.log('latest job:', job);
  const tuning = await getTuning();
  console.log('rpm:', tuning.model.requestsPerMinute, '| model env:', process.env.GEMINI_MODEL);

  const model = await getGeminiModel();
  console.log('resolved model:', (model as any)?.model ?? (model as any)?.modelId ?? '(unknown)');
  const t0 = Date.now();
  try {
    const r: any = await (model as any).generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: OK' }] }],
    });
    const txt = r?.response?.text?.() ?? JSON.stringify(r).slice(0, 200);
    console.log(`gemini smoke OK in ${Date.now() - t0} ms:`, String(txt).slice(0, 80));
  } catch (e: any) {
    console.log(`gemini smoke FAIL after ${Date.now() - t0} ms:`, e?.message?.slice(0, 300));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
