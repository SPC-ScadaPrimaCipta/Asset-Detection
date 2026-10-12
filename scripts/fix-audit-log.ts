import * as fs from 'fs';
import * as path from 'path';

const candidatesPath = path.resolve(process.cwd(), 'storage/yolo-candidates-all-pages.json');
const allCandidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

// Verified human decisions for sheet-7-p1 (all 13 inspected)
const sheet7Decisions: Record<number, { decision: string; category?: string; observed: string }> = {
  0: {
    decision: 'false_positive',
    category: 'equipment_misclassification',
    observed: 'Pump P-004B with motor GE',
  },
  1: {
    decision: 'false_positive',
    category: 'revision_cloud',
    observed: 'Revision cloud STR-38008',
  },
  2: {
    decision: 'false_positive',
    category: 'revision_cloud',
    observed: 'Revision cloud VLV-380715 with annotation text',
  },
  3: {
    decision: 'false_positive',
    category: 'wrong_symbol',
    observed: 'Valve with NC annotation bubble VLV-380710, not a flange/nozzle',
  },
  4: {
    decision: 'false_positive',
    category: 'equipment_misclassification',
    observed: 'Vessel V-011 with valve assembly (VLV-380718/719/717), not instrument panel',
  },
  5: {
    decision: 'false_positive',
    category: 'equipment_misclassification',
    observed: 'Tank T-004 with CLEAN OUT port and manway, not instrument panel',
  },
  6: {
    decision: 'false_positive',
    category: 'wrong_symbol',
    observed: 'Valve with tag VLV-380709 and check valve symbol, not flange/nozzle',
  },
  7: {
    decision: 'false_positive',
    category: 'wrong_symbol',
    observed: 'Valve VLV-380720 with NC annotation, not rupture disk',
  },
  8: {
    decision: 'false_positive',
    category: 'wrong_symbol',
    observed: 'Valve VLV-380698 with strainer STR-38006, not rupture disk',
  },
  9: {
    decision: 'false_positive',
    category: 'wrong_symbol',
    observed: 'Pressure indicator PI P-004 with valve VLV-380695, not flange/nozzle',
  },
  10: {
    decision: 'false_positive',
    category: 'wrong_symbol',
    observed: 'Pressure indicator PI V-011A with valve VLV-380716, not flange/nozzle',
  },
  11: {
    decision: 'false_positive',
    category: 'wrong_symbol',
    observed: 'Valve VLV-380712 with pipe size annotation, not rupture disk',
  },
  12: {
    decision: 'false_positive',
    category: 'wrong_symbol',
    observed: 'Pressure indicator PI P-004 with valve VLV-380711, not rupture disk',
  },
};

// Build clean audit entries for sheet-7-p1 directly from source
const sheet7Audits = (allCandidates['sheet-7-p1'] as any[]).map((cand, idx) => {
  const d = sheet7Decisions[idx];
  return {
    pageId: 'sheet-7-p1',
    candidateId: `sheet-7-p1-crop-${String(idx).padStart(2, '0')}`,
    predictedClassId: cand.classId,
    predictedLabel: cand.label,
    confidence: Number(cand.confidence.toFixed(3)),
    bbox: {
      x: cand.bbox.x,
      y: cand.bbox.y,
      width: cand.bbox.width,
      height: cand.bbox.height,
    },
    auditDecision: d.decision,
    ...(d.category ? { falsePositiveCategory: d.category } : {}),
    observedObject: d.observed,
    reviewedBy: 'human',
    reviewedAt: '2026-10-05',
  };
});

const auditLog = {
  version: '1.0',
  purpose: 'Offline YOLO candidate audit for ground-truth annotation and gate review',
  audits: sheet7Audits,
};

fs.writeFileSync(
  path.resolve(process.cwd(), 'fixtures/ground-truth/candidate-audit-v1.json'),
  JSON.stringify(auditLog, null, 2)
);

console.log('Regenerated candidate-audit-v1.json with exact source fields for all 13 sheet-7-p1 candidates.');
