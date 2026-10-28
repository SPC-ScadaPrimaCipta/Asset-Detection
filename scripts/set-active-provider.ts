import { pool } from '../lib/db';
import { clearAiConfigCache } from '../lib/ai-config';

async function updateProvider() {
  const targetProvider = process.argv[2] || 'openai';
  const res = await pool.query(
    'UPDATE settings SET ai_provider = $1, updated_at = NOW() WHERE id = 1 RETURNING id, ai_provider, openai_model, openai_base_url, gemini_model',
    [targetProvider]
  );
  clearAiConfigCache();
  console.log('Database updated successfully:', res.rows[0]);
}

updateProvider()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

