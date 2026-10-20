import fs from 'fs';

const text = fs.readFileSync('app/detection/page.tsx', 'utf-8');
const lines = text.split('\n');
console.log('Total lines:', lines.length);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/ai|support|gemini|fallback|verifier|engine|model/i.test(line)) {
    if (line.includes('button') || line.includes('Button') || line.includes('Support') || line.includes('AI') || line.includes('Engine') || line.includes('Mode') || line.includes('mode') || line.includes('toggle')) {
      console.log((i + 1) + ': ' + line.trim().slice(0, 120));
    }
  }
}
