/**
 * YOLO P&ID Model — Class Map (single source of truth)
 *
 * VERIFIED MODEL ARCHITECTURE (via onnxruntime-node inspection + real inference):
 *
 *   Input  : [1, 3, 640, 640]  NCHW, RGB, float32, normalized [0,1]
 *   Output : [1, 37, 8400]
 *     channel 0-3   : bbox (cx, cy, width, height) in 640x640 letterbox space
 *     channel 4     : unused — always 0.0; DO NOT treat as objectness
 *     channel 5-36  : final confidence for 32 classes (NOT logits)
 *     class ID      : channel - 5
 *
 * VERIFIED FACTS:
 *   1. Model emits 32 classes (IDs 0-31). Class ID 32 in data.yaml is stale
 *      and NOT present in the ONNX output — it must never be used.
 *   2. `data.yaml` lists 33 names (0-32); the ONNX graph was exported with 32.
 *   3. Channel 4 is all-zero on real data → there is NO separate objectness;
 *      the class score IS the final confidence.
 *   4. Four duplicate labels exist in data.yaml. Three of them are live in the
 *      model output and are resolved to their canonical class:
 *        5  -> 3   (Globe_valve_NO)
 *        27 -> 26  (Instrument_Field)
 *        31 -> 28  (Instrument_Panel)
 *      Class 32->30 has NO counterpart because class 32 is not in the model.
 *   5. Class 0 "Not_used" is not a valid asset — filtered out.
 *
 * NOTE ON assetType: the values below are a PLACEHOLDER mapping for Legend
 * matching. Before a candidate is persisted, the Legend resolver MUST verify
 * against the actual `legend_symbols.asset_type`, `symbol_name`, `aliases`, and
 * `tag_pattern`. If nothing matches, the candidate must go to the Gemini
 * support/fallback path or human verification — it is NOT auto-persisted.
 */

/** Number of classes the ONNX model actually emits. */
export const YOLO_CLASS_COUNT = 32;

/** Highest valid class ID (inclusive). */
export const YOLO_MAX_CLASS_ID = YOLO_CLASS_COUNT - 1;

/** Channel offset of the first class score in the output tensor. */
export const YOLO_CLASS_CHANNEL_OFFSET = 5;

/** Number of candidate anchors in the output tensor. */
export const YOLO_CANDIDATE_COUNT = 8400;

export interface YoloClassInfo {
  id: number;
  /** Raw label exactly as written in data.yaml. */
  yoloLabel: string;
  /** Placeholder asset type for Legend matching (see file header note). */
  assetType: string;
  /** Granular subtype carried into evidence. */
  detectionSubtype?: string;
  aliases: string[];
  /** True = first occurrence of this label; false = duplicate. */
  isCanonical: boolean;
  /** For duplicates, the canonical class id this resolves to. */
  canonicalId?: number;
  /** False = not a valid asset candidate (e.g. class 0 Not_used). */
  isValid: boolean;
}

export const YOLO_CLASS_MAP: Record<number, YoloClassInfo> = {
  0: {
    id: 0,
    yoloLabel: 'Not_used',
    assetType: 'UNKNOWN',
    aliases: [],
    isCanonical: true,
    isValid: false,
  },

  1: {
    id: 1,
    yoloLabel: 'Gate_Valve',
    assetType: 'Valve',
    detectionSubtype: 'gate_valve',
    aliases: ['Gate', 'GV'],
    isCanonical: true,
    isValid: true,
  },

  2: {
    id: 2,
    yoloLabel: 'Ball_Valve',
    assetType: 'Valve',
    detectionSubtype: 'ball_valve',
    aliases: ['Ball', 'BV'],
    isCanonical: true,
    isValid: true,
  },

  3: {
    id: 3,
    yoloLabel: 'Globe_valve_NO',
    assetType: 'Valve',
    detectionSubtype: 'globe_valve_no',
    aliases: ['Globe', 'NO'],
    isCanonical: true,
    isValid: true,
  },

  4: {
    id: 4,
    yoloLabel: 'Gate_valve_NO',
    assetType: 'Valve',
    detectionSubtype: 'gate_valve_no',
    aliases: ['Gate NO'],
    isCanonical: true,
    isValid: true,
  },

  5: {
    id: 5,
    yoloLabel: 'Globe_valve_NO',
    assetType: 'Valve',
    detectionSubtype: 'globe_valve_no',
    aliases: [],
    isCanonical: false,
    canonicalId: 3,
    isValid: true,
  },

  6: {
    id: 6,
    yoloLabel: 'Butterfly_valve',
    assetType: 'Valve',
    detectionSubtype: 'butterfly_valve',
    aliases: ['Butterfly', 'BFV'],
    isCanonical: true,
    isValid: true,
  },

  7: {
    id: 7,
    yoloLabel: 'Plug valve',
    assetType: 'Valve',
    detectionSubtype: 'plug_valve',
    aliases: ['Plug'],
    isCanonical: true,
    isValid: true,
  },

  8: {
    id: 8,
    yoloLabel: 'Check_valve',
    assetType: 'Valve',
    detectionSubtype: 'check_valve',
    aliases: ['Check', 'CHKV'],
    isCanonical: true,
    isValid: true,
  },

  9: {
    id: 9,
    yoloLabel: 'Diaphragm_valve',
    assetType: 'Valve',
    detectionSubtype: 'diaphragm_valve',
    aliases: ['Diaphragm'],
    isCanonical: true,
    isValid: true,
  },

  10: {
    id: 10,
    yoloLabel: 'Needle_valve',
    assetType: 'Valve',
    detectionSubtype: 'needle_valve',
    aliases: ['Needle'],
    isCanonical: true,
    isValid: true,
  },

  11: {
    id: 11,
    yoloLabel: 'Half_Filled_Gate_Valve',
    assetType: 'Valve',
    detectionSubtype: 'half_filled_gate_valve',
    aliases: ['Half Filled'],
    isCanonical: true,
    isValid: true,
  },

  12: {
    id: 12,
    yoloLabel: 'Gate_Valve_NC',
    assetType: 'Valve',
    detectionSubtype: 'gate_valve_nc',
    aliases: ['Gate NC', 'GNC'],
    isCanonical: true,
    isValid: true,
  },

  13: {
    id: 13,
    yoloLabel: 'Globle_valve_NC',
    assetType: 'Valve',
    detectionSubtype: 'globe_valve_nc',
    aliases: ['Globe NC'],
    isCanonical: true,
    isValid: true,
  },

  14: {
    id: 14,
    yoloLabel: 'Control_Valve',
    assetType: 'Control Valve',
    detectionSubtype: 'control_valve',
    aliases: ['Control', 'CV', 'FCV'],
    isCanonical: true,
    isValid: true,
  },

  15: {
    id: 15,
    yoloLabel: 'Rotary_Valve',
    assetType: 'Valve',
    detectionSubtype: 'rotary_valve',
    aliases: ['Rotary'],
    isCanonical: true,
    isValid: true,
  },

  16: {
    id: 16,
    yoloLabel: 'Ball_valve_NC',
    assetType: 'Valve',
    detectionSubtype: 'ball_valve_nc',
    aliases: ['Ball NC'],
    isCanonical: true,
    isValid: true,
  },

  17: {
    id: 17,
    yoloLabel: 'Paddle_blind',
    assetType: 'Paddle Blind',
    detectionSubtype: 'paddle_blind',
    aliases: ['Paddle Blind'],
    isCanonical: true,
    isValid: true,
  },

  18: {
    id: 18,
    yoloLabel: 'Spectacle_blind_Closed',
    assetType: 'Spectacle Blind',
    detectionSubtype: 'spectacle_blind_closed',
    aliases: ['Spectacle Blind Closed'],
    isCanonical: true,
    isValid: true,
  },

  19: {
    id: 19,
    yoloLabel: 'Spectacle_blind_Open',
    assetType: 'Spectacle Blind',
    detectionSubtype: 'spectacle_blind_open',
    aliases: ['Spectacle Blind Open'],
    isCanonical: true,
    isValid: true,
  },

  20: {
    id: 20,
    yoloLabel: 'Reducer',
    assetType: 'Reducer',
    detectionSubtype: 'reducer',
    aliases: [],
    isCanonical: true,
    isValid: true,
  },

  21: {
    id: 21,
    yoloLabel: 'Flange_or_Nozzle',
    assetType: 'Flange',
    detectionSubtype: 'flange_or_nozzle',
    aliases: ['Nozzle'],
    isCanonical: true,
    isValid: true,
  },

  22: {
    id: 22,
    yoloLabel: 'Rupture_disk',
    assetType: 'Rupture Disk',
    detectionSubtype: 'rupture_disk',
    aliases: ['Rupture Disk', 'RD'],
    isCanonical: true,
    isValid: true,
  },

  23: {
    id: 23,
    yoloLabel: 'Pipe_Insulation_or_Tracing',
    assetType: 'Pipe',
    detectionSubtype: 'pipe_insulation_or_tracing',
    aliases: ['Insulation', 'Tracing'],
    isCanonical: true,
    isValid: true,
  },

  24: {
    id: 24,
    yoloLabel: 'Flow_Arrow',
    assetType: 'Flow Arrow',
    detectionSubtype: 'flow_arrow',
    aliases: ['Flow Arrow'],
    isCanonical: true,
    isValid: true,
  },

  25: {
    id: 25,
    yoloLabel: 'sight_glass',
    assetType: 'Sight Glass',
    detectionSubtype: 'sight_glass',
    aliases: ['Sight Glass'],
    isCanonical: true,
    isValid: true,
  },

  26: {
    id: 26,
    yoloLabel: 'Instrument_Field',
    assetType: 'Instrument',
    detectionSubtype: 'instrument_field',
    aliases: ['Field Instrument'],
    isCanonical: true,
    isValid: true,
  },

  27: {
    id: 27,
    yoloLabel: 'Instrument_Field',
    assetType: 'Instrument',
    detectionSubtype: 'instrument_field',
    aliases: [],
    isCanonical: false,
    canonicalId: 26,
    isValid: true,
  },

  28: {
    id: 28,
    yoloLabel: 'Instrument_Panel',
    assetType: 'Instrument',
    detectionSubtype: 'instrument_panel',
    aliases: ['Panel Instrument'],
    isCanonical: true,
    isValid: true,
  },

  29: {
    id: 29,
    yoloLabel: 'Instrument_Aux_Panel',
    assetType: 'Instrument',
    detectionSubtype: 'instrument_aux_panel',
    aliases: ['Auxiliary Panel Instrument'],
    isCanonical: true,
    isValid: true,
  },

  30: {
    id: 30,
    yoloLabel: 'box',
    assetType: 'Instrument',
    detectionSubtype: 'instrument_box',
    aliases: ['Box'],
    isCanonical: true,
    isValid: true,
  },

  31: {
    id: 31,
    yoloLabel: 'Instrument_Panel',
    assetType: 'Instrument',
    detectionSubtype: 'instrument_panel',
    aliases: [],
    isCanonical: false,
    canonicalId: 28,
    isValid: true,
  },
};

/**
 * Resolve a raw class id to its canonical class info.
 * Duplicates resolve to their canonical entry. Invalid ids (out of range,
 * class 0 Not_used, or a broken canonical reference) return null.
 */
export function resolveYoloClass(classId: number): YoloClassInfo | null {
  if (!Number.isInteger(classId) || classId < 0 || classId >= YOLO_CLASS_COUNT) {
    return null;
  }

  const info = YOLO_CLASS_MAP[classId];
  if (!info || !info.isValid) {
    return null;
  }

  if (info.isCanonical) {
    return info;
  }

  if (info.canonicalId === undefined) {
    return null;
  }

  const canonical = YOLO_CLASS_MAP[info.canonicalId];
  return canonical?.isValid ? canonical : null;
}

/** Canonical class ids that can produce detections. */
export function getCanonicalClassIds(): number[] {
  return Object.values(YOLO_CLASS_MAP)
    .filter((c) => c.isCanonical && c.isValid)
    .map((c) => c.id);
}

/**
 * Build-time / load-time validation. Throws if the map is inconsistent:
 *  - ids are not exactly 0..YOLO_CLASS_COUNT-1
 *  - a duplicate points at a missing or non-canonical target
 *  - a label is duplicated without a canonical/duplicate pairing
 */
export function validateYoloClassMap(expectedClassCount = YOLO_CLASS_COUNT): void {
  const ids = Object.keys(YOLO_CLASS_MAP)
    .map(Number)
    .sort((a, b) => a - b);

  if (ids.length !== expectedClassCount) {
    throw new Error(
      `YOLO class map mismatch: map has ${ids.length} entries, expected ${expectedClassCount}`,
    );
  }

  if (ids[0] !== 0 || ids[ids.length - 1] !== expectedClassCount - 1) {
    throw new Error('YOLO class IDs are not contiguous 0..N-1');
  }

  for (const info of Object.values(YOLO_CLASS_MAP)) {
    if (!info.isCanonical) {
      if (info.canonicalId === undefined) {
        throw new Error(`Class ${info.id} is marked duplicate but has no canonicalId`);
      }
      const canonical = YOLO_CLASS_MAP[info.canonicalId];
      if (!canonical || !canonical.isCanonical) {
        throw new Error(
          `Class ${info.id} references invalid canonical class ${info.canonicalId}`,
        );
      }
    } else if (info.canonicalId !== undefined) {
      throw new Error(`Canonical class ${info.id} must not declare a canonicalId`);
    }
  }

  // Class 0 is reserved and must never be a valid asset candidate.
  if (YOLO_CLASS_MAP[0]?.isValid) {
    throw new Error('Class 0 (Not_used) must not be marked valid');
  }
}

// Fail fast if the map is malformed.
validateYoloClassMap();
