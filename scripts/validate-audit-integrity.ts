import * as fs from 'fs';
import * as path from 'path';

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Candidate {
  classId: number;
  label: string;
  confidence: number;
  bbox: BBox;
}

interface AuditEntry {
  pageId: string;
  candidateId: string;
  predictedClassId: number;
  predictedLabel: string;
  confidence: number;
  bbox: BBox;
  auditDecision: string;
  [key: string]: any;
}

interface AuditLog {
  version: string;
  purpose: string;
  audits: AuditEntry[];
}

async function validateAuditIntegrity() {
  const candidatesPath = path.resolve(process.cwd(), 'storage/yolo-candidates-all-pages.json');
  const auditPath = path.resolve(process.cwd(), 'fixtures/ground-truth/candidate-audit-v1.json');

  const allCandidates: Record<string, Candidate[]> = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
  const auditLog: AuditLog = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

  console.log('=== AUDIT INTEGRITY VALIDATION ===\n');

  const issues: string[] = [];
  const seenCandidates = new Set<string>();

  for (const audit of auditLog.audits) {
    const key = `${audit.pageId}::${audit.candidateId}`;

    // Check for duplicates
    if (seenCandidates.has(key)) {
      issues.push(`DUPLICATE: ${key}`);
      continue;
    }
    seenCandidates.add(key);

    // Extract crop index from candidateId (e.g., "sheet-7-p1-crop-00" -> 0)
    const match = audit.candidateId.match(/-crop-(\d+)$/);
    if (!match) {
      issues.push(`INVALID_ID: ${audit.candidateId} (cannot parse crop index)`);
      continue;
    }
    const cropIdx = parseInt(match[1], 10);

    // Get source candidate
    const pageCandidates = allCandidates[audit.pageId];
    if (!pageCandidates) {
      issues.push(`MISSING_PAGE: ${audit.pageId} not found in candidates JSON`);
      continue;
    }

    if (cropIdx >= pageCandidates.length) {
      issues.push(`OUT_OF_BOUNDS: ${audit.candidateId} index ${cropIdx} but page has ${pageCandidates.length} candidates`);
      continue;
    }

    const source = pageCandidates[cropIdx];

    // Validate classId
    if (audit.predictedClassId !== source.classId) {
      issues.push(`CLASS_MISMATCH: ${key} audit=${audit.predictedClassId} source=${source.classId}`);
    }

    // Validate confidence (tolerance 0.001)
    const confDiff = Math.abs(audit.confidence - source.confidence);
    if (confDiff > 0.001) {
      issues.push(`CONFIDENCE_MISMATCH: ${key} audit=${audit.confidence.toFixed(3)} source=${source.confidence.toFixed(3)} (diff=${confDiff.toFixed(4)})`);
    }

    // Validate bbox (exact match)
    if (
      audit.bbox.x !== source.bbox.x ||
      audit.bbox.y !== source.bbox.y ||
      audit.bbox.width !== source.bbox.width ||
      audit.bbox.height !== source.bbox.height
    ) {
      issues.push(
        `BBOX_MISMATCH: ${key}\n` +
        `  audit:  [x:${audit.bbox.x}, y:${audit.bbox.y}, w:${audit.bbox.width}, h:${audit.bbox.height}]\n` +
        `  source: [x:${source.bbox.x}, y:${source.bbox.y}, w:${source.bbox.width}, h:${source.bbox.height}]`
      );
    }
  }

  // Summary
  console.log(`Total audits: ${auditLog.audits.length}`);
  console.log(`Unique candidates audited: ${seenCandidates.size}`);
  console.log(`Issues found: ${issues.length}\n`);

  if (issues.length > 0) {
    console.log('ISSUES:\n');
    issues.forEach((issue, i) => console.log(`${i + 1}. ${issue}\n`));
    process.exit(1);
  } else {
    console.log('✓ All audit entries validated successfully.');
    console.log('✓ No duplicates found.');
    console.log('✓ All classId, confidence, and bbox values match source candidates.');
  }
}

validateAuditIntegrity().catch((e) => {
  console.error(e);
  process.exit(1);
});
