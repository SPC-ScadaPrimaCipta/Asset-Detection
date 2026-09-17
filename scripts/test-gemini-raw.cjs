// NO dotenv — read from process.env directly
const { GoogleGenerativeAI } = require('@google/generative-ai');

console.log('MODEL:', process.env.GEMINI_MODEL);
console.log('KEY prefix:', process.env.GEMINI_API_KEY?.slice(0, 15));

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = client.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: 'application/json' },
});

model.generateContent([{ text: 'Return JSON: {"test":"ok","model":"working"}' }])
  .then(r => { console.log('SUCCESS:', r.response.text()); })
  .catch(e => { console.error('ERROR:', e.message.slice(0, 400)); });
