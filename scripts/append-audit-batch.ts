import * as fs from 'fs';
import * as path from 'path';

const root = process.cwd();
const candidatePath = path.join(root, 'storage/yolo-candidates-all-pages.json');
const auditPath = path.join(root, 'fixtures/ground-truth/candidate-audit-v1.json');
const candidates = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as Record<string, any[]>;
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as { audits: any[] };

const decisions: Record<string, any> = {
  // sheet-1
  'sheet-1-p1-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Tank T-012 rectangular vessel symbol' },
  'sheet-1-p1-crop-01': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Pump P-006 with motor EM' },
  // sheet-2
  'sheet-2-p1-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'revision_cloud', observedObject: 'NON ACTIVE LINE annotation cloud' },
  'sheet-2-p1-crop-01': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Valve assembly with VLV-380195 annotation' },
  'sheet-2-p1-crop-02': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Control valve PCV-380018 assembly with annotation bubbles' },
  'sheet-2-p1-crop-03': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Control valve and pressure controller PC V-003A assembly' },
  // sheet-4
  'sheet-4-p1-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Gas lift equipment K-001A rectangular process unit' },
  'sheet-4-p1-crop-01': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Vessel K-003 TGD rectangular process unit' },
  'sheet-4-p1-crop-02': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Vertical vessel V-010 with manway and connected piping' },
  'sheet-4-p1-crop-03': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Process unit K-002 PDM rectangular equipment' },
  'sheet-4-p1-crop-04': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Process unit K-004B idle rectangular equipment' },
  'sheet-4-p1-crop-05': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Process unit K-002 PDM rectangular equipment' },
  'sheet-4-p1-crop-06': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Valve and PI assembly PCV V-004B, not instrument panel' },
  'sheet-4-p1-crop-07': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Valve and PI assembly PI K-001C, not instrument panel' },
  'sheet-4-p1-crop-08': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'AG/UG line marker, not globe valve' },
  'sheet-4-p1-crop-09': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'AG/UG line marker and pipe junction, not reducer' },
  // sheet-5
  'sheet-5-p1-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'revision_cloud', observedObject: 'PI 380057 and valve inside revision cloud, not spectacle blind' },
  // sheet-11
  'sheet-11-p1-crop-00': { auditDecision: 'true_positive', actualClassId: 11, actualLabel: 'Half_Filled_Gate_Valve', observedObject: 'Half-filled gate valve symbol' },
  'sheet-11-p1-crop-01': { auditDecision: 'true_positive', actualClassId: 24, actualLabel: 'Flow_Arrow', observedObject: 'Flow arrow symbol' },
  'sheet-11-p1-crop-02': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'PSH/PS P702 instrument bubble, not flow arrow' },
  'sheet-11-p1-crop-03': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'LCP panel for diesel pump, not flow arrow' },
  'sheet-11-p1-crop-04': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'LCP panel for diesel pump, not flow arrow' },
  'sheet-11-p1-crop-05': { auditDecision: 'false_positive', falsePositiveCategory: 'revision_cloud', observedObject: 'Revision cloud around valve VLV-380799, not flange/nozzle' },
  'sheet-11-p1-crop-06': { auditDecision: 'false_positive', falsePositiveCategory: 'revision_cloud', observedObject: 'Revision cloud around valve VLV-380844, not rupture disk' },
  'sheet-11-p1-crop-07': { auditDecision: 'false_positive', falsePositiveCategory: 'revision_cloud', observedObject: 'Revision cloud and valve annotation, not rupture disk' },
  // sheet-7 model variant
  'sheet-7-model-p1-crop-03': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Normally closed valve and reducer/pipe-size assembly, not flange/nozzle' },
  'sheet-7-model-p1-crop-04': { auditDecision: 'wrong_class', actualClassId: 12, actualLabel: 'Gate_Valve_NC', observedObject: 'Normally closed gate valve symbol with 6-inch pipe-size annotation' },
  // fire-water-p1
  'fire-water-p1-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'LCP motor control panel diamond, not flow arrow' },
  'fire-water-p1-crop-01': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'PSH/P702 instrument bubble, not flow arrow' },
  'fire-water-p1-crop-02': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Instrument diamond marked I / MC-FA, not flow arrow' },
  'fire-water-p1-crop-03': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'LCP motor control panel diamond, not flow arrow' },
  'fire-water-p1-crop-04': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Half-filled gate valve symbol, not flange/nozzle' },
  'fire-water-p1-crop-05': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'D-13 day tank rectangular vessel, not auxiliary instrument panel' },
  'fire-water-p1-crop-06': { auditDecision: 'true_positive', actualClassId: 11, actualLabel: 'Half_Filled_Gate_Valve', observedObject: 'Half-filled gate valve symbol' },
  'fire-water-p1-crop-07': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Gate/check valve assembly with pipe-size annotations, not flange/nozzle' },
  'fire-water-p1-crop-08': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Pressure switch annotation and dashed system boundary, not rupture disk' },
  'fire-water-p1-crop-09': { auditDecision: 'true_positive', actualClassId: 16, actualLabel: 'Ball_valve_NC', observedObject: 'Normally closed ball valve below PI PDT-12' },
  'fire-water-p1-crop-10': { auditDecision: 'false_positive', falsePositiveCategory: 'annotation_text', observedObject: 'Sheet title block and drawing metadata, not rupture disk' },
  // fire-water-p2
  'fire-water-p2-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'LCP/control panel enclosure, not instrument panel symbol' },
  'fire-water-p2-crop-01': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'TANGKI WESTINDO AREA enclosure and vessel outline, not box symbol' },
  'fire-water-p2-crop-02': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'CONDENSATE TANK AREA enclosure, not instrument panel' },
  'fire-water-p2-crop-03': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'CONDENSATE TANK AREA enclosure, not auxiliary instrument panel' },
  'fire-water-p2-crop-04': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'R. PANEL AREA enclosure, not auxiliary instrument panel' },
  'fire-water-p2-crop-05': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Dashed equipment boundary/outline, not rupture disk' },
  // sheet-7-rev-p1
  'sheet-7-rev-p1-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Pump P-004B with motor, not rupture disk' },
  'sheet-7-rev-p1-crop-01': { auditDecision: 'false_positive', falsePositiveCategory: 'revision_cloud', observedObject: 'Revision cloud STR-38008 annotation' },
  'sheet-7-rev-p1-crop-02': { auditDecision: 'false_positive', falsePositiveCategory: 'revision_cloud', observedObject: 'Revision cloud around VLV-380715 annotation' },
  'sheet-7-rev-p1-crop-03': { auditDecision: 'false_positive', falsePositiveCategory: 'revision_cloud', observedObject: 'Revision cloud around VLV-380710 valve annotation' },
  'sheet-7-rev-p1-crop-04': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Vessel V-011 with valve assemblies, not auxiliary instrument panel' },
  'sheet-7-rev-p1-crop-05': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Tank T-004 with clean-out and manway, not auxiliary instrument panel' },
  'sheet-7-rev-p1-crop-06': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Valve VLV-380709 and check valve assembly, not flange/nozzle' },
  'sheet-7-rev-p1-crop-07': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Valve VLV-380720 with NC annotation, not rupture disk' },
  'sheet-7-rev-p1-crop-08': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Valve VLV-380698 with strainer STR-38006, not rupture disk' },
  'sheet-7-rev-p1-crop-09': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Pressure indicator PI P-004 with valve, not flange/nozzle' },
  'sheet-7-rev-p1-crop-10': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Pressure indicator PI V-011A with valve, not flange/nozzle' },
  'sheet-7-rev-p1-crop-11': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Valve VLV-380712 with pipe-size annotation, not rupture disk' },
  'sheet-7-rev-p1-crop-12': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'Pressure indicator PI P-004 with valve VLV-380711, not rupture disk' },
  // sheet-7-model-p1
  'sheet-7-model-p1-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Pump P-004B with motor and NOTE 1, not rupture disk' },
  'sheet-7-model-p1-crop-01': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Vessel V-011 with connected piping, not auxiliary instrument panel' },
  'sheet-7-model-p1-crop-02': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'Pump P-004-A with pipe-size annotation, not rupture disk' },
  // sheet-12 remaining
  'sheet-12-p1-crop-05': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'CONDENSATE TANK AREA enclosure, not auxiliary instrument panel' },
  'sheet-12-p1-crop-06': { auditDecision: 'false_positive', falsePositiveCategory: 'annotation_text', observedObject: 'Revision cloud around pipe tag PDT-380165, not rupture disk' },
  'sheet-12-p1-crop-07': { auditDecision: 'false_positive', falsePositiveCategory: 'annotation_text', observedObject: 'Revision cloud around pipe tag FH-380002, not auxiliary instrument panel' },
  // sheet-12
  'sheet-12-p1-crop-00': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'LOADING CONDENSATE area enclosure, not auxiliary instrument panel' },
  'sheet-12-p1-crop-01': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'R. PANEL AREA enclosure, not auxiliary instrument panel' },
  'sheet-12-p1-crop-02': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'CONDENSATE TRAP enclosure, not auxiliary instrument panel' },
  'sheet-12-p1-crop-03': { auditDecision: 'false_positive', falsePositiveCategory: 'equipment_misclassification', observedObject: 'TANGKI WESTINDO AREA enclosure, not instrument box' },
  'sheet-12-p1-crop-04': { auditDecision: 'false_positive', falsePositiveCategory: 'wrong_symbol', observedObject: 'AG/UG line marker, not reducer' },
};

const existing = new Set(audit.audits.map((x) => x.candidateId));
for (const [candidateId, decision] of Object.entries(decisions)) {
  if (existing.has(candidateId)) continue;
  const match = candidateId.match(/^(.*)-crop-(\d+)$/);
  if (!match) throw new Error(`Invalid candidate ID: ${candidateId}`);
  const pageId = match[1];
  const index = Number(match[2]);
  const source = candidates[pageId]?.[index];
  if (!source) throw new Error(`Missing source candidate: ${candidateId}`);
  audit.audits.push({
    pageId,
    candidateId,
    predictedClassId: source.classId,
    predictedLabel: source.label,
    confidence: Number(source.confidence.toFixed(3)),
    bbox: source.bbox,
    ...decision,
    reviewedBy: 'human',
    reviewedAt: '2026-10-05',
  });
}
fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');
console.log(`Added ${Object.keys(decisions).filter((id) => !existing.has(id)).length} audit records.`);
console.log(`Total formal audit records: ${audit.audits.length}`);
