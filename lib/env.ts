import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}
loadEnvFiles();

// Do NOT require GEMINI/DEEPSEEK keys at startup — they live in DB (Settings page)
// and are resolved at runtime via lib/ai-config.ts. This prevents `npm run worker` crash
// when keys are only in DB, not .env.local.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — set in .env.local'),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  AI_PROVIDER: z.enum(['gemini', 'deepseek']).default('gemini'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  STORAGE_PATH: z.string().default('./storage'),
});

let parsed: z.infer<typeof envSchema>;
try {
  parsed = envSchema.parse(process.env);
} catch (e: unknown) {
  if (e instanceof z.ZodError) {
    const msg = e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n  - ');
    console.error(`[env] Validation failed:\n  - ${msg}\n\nFix: create/update .env.local. Example:\n  DATABASE_URL=postgresql://user:password@localhost:5432/asset_detection\n  REDIS_URL=redis://localhost:6379\n  # API keys can also be set via Settings page UI (stored in DB)\n`);
  }
  throw e;
}
export const env = parsed;
