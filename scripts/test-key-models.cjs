const { GoogleGenerativeAI } = require('@google/generative-ai');
const KEY = 'AQ.Ab8RN6LzpP9W9sO09iVrhrJLNzn9CyQeM8DG25EVFAPg8FQQgQ';

async function main() {
  const genai = new GoogleGenerativeAI(KEY);

  // List available models first
  console.log('Fetching model list...');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${KEY}&pageSize=50`);
  const data = await res.json();
  if (!res.ok) { console.log('Error:', JSON.stringify(data)); return; }
  
  const models = (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''));
  
  console.log('Available models:', models.join(', '));

  // Test first valid model
  if (models.length === 0) { console.log('No models available'); return; }
  const modelName = models[0];
  console.log(`\nTesting model: ${modelName}`);
  
  try {
    const model = genai.getGenerativeModel({ model: modelName });
    const r = await model.generateContent('Say hello');
    console.log('SUCCESS:', r.response.text().slice(0, 100));
  } catch (e) {
    console.log('Error:', e.message?.slice(0, 300));
  }
}

main().catch(console.error);
