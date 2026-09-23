import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('No GEMINI_API_KEY'); process.exit(1); }

const ai = new GoogleGenerativeAI(key);

const MODELS = [
  'gemini-3.6-flash',
  'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-pro-preview-05-06',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-exp-1206',
  'gemini-2.0-flash-exp',
];

async function testModel(name) {
  try {
    const model = ai.getGenerativeModel({ model: name, generationConfig: { temperature: 0, maxOutputTokens: 64 } });
    const result = await model.generateContent('Reply with: OK');
    const text = result.response.text().trim();
    console.log(`✓ ${name}: ${text.slice(0, 50)}`);
    return true;
  } catch (e) {
    const msg = e.message.slice(0, 150);
    console.log(`✗ ${name}: ${msg}`);
    return false;
  }
}

console.log('Testing models...\n');
for (const m of MODELS) {
  await testModel(m);
  await new Promise(r => setTimeout(r, 500));
}
