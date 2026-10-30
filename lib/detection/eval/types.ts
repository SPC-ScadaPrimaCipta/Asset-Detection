/**
 * YOLO evaluation harness — shared types.
 *
 * OFFLINE ONLY. Nothing here is imported by the production detection pipeline.
 * Purpose: measure YOLO model accuracy against manual ground truth so we can
 * decide whether the model is fit to become a V3.0 primary engine.
 */

/** Ground-truth bbox in SOURCE PIXEL coordinates of the rendered page image. */
export interface GroundTruthBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One manually annotated symbol on a page. */
export interface GroundTruthAnnotation {
  /** Stable id, e.g. "gt-001". Used for reporting. */
  id: string;
  /** Canonical YOLO class id (0-31) — must be a class the model actually has. */
  classId: number;
  label: string;
  bbox: GroundTruthBbox;
  /** Optional free-text note from the annotator. */
  note?: string;
}

/** One annotated page. */
export interface GroundTruthPage {
  pageId: string;
  /** Path to the rendered page PNG, relative to the ground-truth file. */
  imagePath: string;
  width: number;
  height: number;
  annotations: GroundTruthAnnotation[];
}

/** Root ground-truth document. */
export interface GroundTruthDataset {
  /** Human description of the dataset / annotation ruleset version. */
  description?: string;
  /** IoU threshold used to declare a match. Default 0.50. */
  iouThreshold?: number;
  pages: GroundTruthPage[];
}

/**
 * False-positive cause categories. Every FP must be classified — a large
 * "unknown" bucket means the taxonomy is missing a case.
 */
export const FP_CATEGORIES = [
  'wrong_symbol',
  'text_annotation',
  'revision_cloud',
  'title_block',
  'border_or_grid',
  'line_or_connection',
  'equipment_misclassification',
  'unknown',
] as const;

export type FpCategory = (typeof FP_CATEGORIES)[number];

/** One matched pair. */
export interface MatchRecord {
  pageId: string;
  classId: number;
  label: string;
  confidence: number;
  iou: number;
  gtId: string;
  /** Detection bbox in source pixels. */
  detectionBbox: GroundTruthBbox;
  /** Ground-truth bbox in source pixels. */
  gtBbox: GroundTruthBbox;
}

/** One unmatched detection (false positive). */
export interface FalsePositiveRecord {
  pageId: string;
  classId: number;
  label: string;
  confidence: number;
  bbox: GroundTruthBbox;
  /** Manually assigned cause; 'unknown' until classified. */
  category: FpCategory;
  /** Overlapping GT class ids, if the box landed on some other symbol. */
  overlappingGtClasses: number[];
}

/** One unmatched ground-truth symbol (false negative). */
export interface FalseNegativeRecord {
  pageId: string;
  classId: number;
  label: string;
  gtId: string;
  bbox: GroundTruthBbox;
  /** Highest-confidence detection on this box, if any (helps see near-misses). */
  bestDetectionConfidence: number | null;
  bestDetectionClassId: number | null;
}

export interface ConfusionRecord {
  pageId: string;
  gtId: string;
  gtClassId: number;
  gtLabel: string;
  predictedClassId: number;
  predictedLabel: string;
  confidence: number;
  iou: number;
}

export interface Metrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Metrics for one confidence threshold. */
export interface ThresholdResult {
  threshold: number;
  global: Metrics;
  perPage: Array<{ pageId: string } & Metrics>;
  perClass: Array<{
    classId: number;
    label: string;
    /** GT instances for this class across the dataset. */
    gtCount: number;
    /** Insufficient sample: gtCount below the reporting floor. */
    insufficientSample: boolean;
  } & Metrics>;
  matches: MatchRecord[];
  falsePositives: FalsePositiveRecord[];
  falseNegatives: FalseNegativeRecord[];
  /** GT symbol matched by a detection of a different class (IoU ok, class wrong). */
  confusions: ConfusionRecord[];
  /** Confidence histogram, 10 buckets of 0.1. */
  confidenceDistribution: { bucket: string; count: number }[];
}

export interface EvaluationReport {
  generatedAt: string;
  modelPath: string;
  datasetPath: string;
  iouThreshold: number;
  /** GT count below this is flagged insufficient sample in per-class results. */
  minSamplesPerClass: number;
  pageCount: number;
  annotationCount: number;
  thresholds: ThresholdResult[];
}