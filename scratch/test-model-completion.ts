import { getAiConfig } from '../lib/ai-config';
import { getVisionProvider } from '../lib/ai-providers';

async function main() {
  const cfg = await getAiConfig();
  console.log('Testing model:', cfg.openaiModel, 'via', cfg.openaiBaseUrl);
  const provider = await getVisionProvider(cfg);

  // 1x1 red dot png base64
  const redDotB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  try {
    const res = await provider.generateVisionCompletion({
      model: cfg.openaiModel,
      prompt: 'What is this image? Reply JSON: {"type": "color"}',
      imageBase64: redDotB64,
      mimeType: 'image/png',
      maxTokens: 50,
      responseFormat: 'json',
    });
    console.log('SUCCESS! Response:', res.text);
  } catch (err: any) {
    console.error('ERROR from provider:', err.message);
    if (err.status) console.error('Status:', err.status);
    if (err.response) console.error('Response:', err.response);
  }
}

main().catch(console.error);
