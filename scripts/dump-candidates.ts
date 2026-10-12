import * as fs from 'fs';
import * as path from 'path';

const candidatesPath = path.resolve(process.cwd(), 'storage/yolo-candidates-all-pages.json');
const data = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

console.log('=== CANDIDATE SUMMARY FOR ALL PAGES ===');
for (const [pageId, dets] of Object.entries(data)) {
  const dList = dets as any[];
  console.log(`\n--- ${pageId} (${dList.length} candidates) ---`);
  dList.forEach((d, i) => {
    console.log(
      `  crop_${String(i).padStart(2, '0')}: classId=${d.classId} (${d.label}), conf=${d.confidence.toFixed(3)}, bbox=[x:${d.bbox.x}, y:${d.bbox.y}, w:${d.bbox.width}, h:${d.bbox.height}]`
    );
  });
}
