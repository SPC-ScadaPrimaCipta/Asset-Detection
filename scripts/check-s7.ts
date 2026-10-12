import * as fs from 'fs';
import * as path from 'path';

const candidatesPath = path.resolve(process.cwd(), 'storage/yolo-candidates-all-pages.json');
const allCandidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

const s7 = allCandidates['sheet-7-p1'];
console.log(JSON.stringify(s7, null, 2));
