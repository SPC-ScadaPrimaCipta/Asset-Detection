import * as fs from 'fs';
import * as path from 'path';

// Load .env.local before any other import so process.env is populated
// when lib/env.ts validation runs.
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    // Strip inline comments: value before first unquoted #
    let value = trimmed.slice(eqIdx + 1).trim();
    const hashIdx = value.indexOf('#');
    if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
