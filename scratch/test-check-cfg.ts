import { getAiConfig } from '../lib/ai-config';

async function main() {
  const cfg = await getAiConfig();
  console.log('AI Config:', {
    provider: cfg.provider,
    openaiModel: cfg.openaiModel,
    openaiBaseUrl: cfg.openaiBaseUrl,
    hasOpenaiKey: !!cfg.openaiKey,
  });
}

main().catch(console.error);
