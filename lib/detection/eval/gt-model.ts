/**
 * Detection V2 — Ground Truth annotation model (TS mirror of gt_schema.py).
 * Human-authored only. Predictions are matched against this set.
 */
export type GTStatus = 'positive' | 'negative' | 'ambiguous' | 'unknown';

export interface GTBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GTAsset {
  id: string;
  bbox: GTBox;
  symbolLabel: string;
  symbolId: string;
  tag: string | null;
  tagRaw: string | null;
  tagBBox: GTBox | null;
  status: GTStatus;
  notes: string;
}

export interface GTNegative {
  id: string;
  bbox: GTBox;
  kind: 'pipe-spec' | 'title-text' | 'marker' | 'dimension' | 'other' | string;
  text: string;
  notes: string;
}

export interface GTPage {
  page: number;
  source: string;
  coordMethod: 'visual-estimate' | 'cad-measured';
  conditions: Record<string, string | number>;
  assets: GTAsset[];
  negatives: GTNegative[];
  annotator: string;
  version: string;
}
