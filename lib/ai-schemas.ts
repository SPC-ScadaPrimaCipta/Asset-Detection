import { z } from "zod";

// BBox: 0-1000 normalized coordinate space.
// Gemini sometimes returns raw pixel coordinates instead of normalized 0-1000 values.
// Auto-detect: if any coordinate or dimension value > 1000, treat entire bbox as pixel
// coords and normalize proportionally. This prevents valid detections being silently
// dropped when Gemini ignores the normalization instruction.
function normalizeBBoxValues(raw: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = raw;
  const maxExtent = Math.max(x + width, y + height, 1);
  if (maxExtent <= 1000) {
    // Already normalized — clamp to valid range
    return {
      x:      Math.max(0, x),
      y:      Math.max(0, y),
      width:  Math.max(1, width),
      height: Math.max(1, height),
    };
  }
  // Pixel coordinates detected — normalize to 0-1000 using max extent as reference.
  // Proportional accuracy preserved even if we don't know exact image dimensions.
  const scale = 1000 / maxExtent;
  return {
    x:      Math.max(0, Math.round(x      * scale)),
    y:      Math.max(0, Math.round(y      * scale)),
    width:  Math.max(1, Math.round(width  * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export const BBoxSchema = z.object({
  x:      z.number(),
  y:      z.number(),
  width:  z.number(),
  height: z.number(),
}).refine(
  // Negative origins are malformed AI output — reject, don't silently clamp.
  // (Zero width/height is still coerced to 1 below; degenerate size is then
  // caught separately by calibrateConfidence which caps confidence at 0.30.)
  (v) => v.x >= 0 && v.y >= 0,
  { message: "bbox x/y must be >= 0" }
).transform(raw => {
  const n = normalizeBBoxValues(raw);
  // Final clamp: nothing escapes valid 0-1000 space after normalization
  return {
    x:      Math.min(999, n.x),
    y:      Math.min(999, n.y),
    width:  Math.min(1000 - n.x, n.width),
    height: Math.min(1000 - n.y, n.height),
  };
});

export const DetectionSchema = z.object({
  assetType:      z.string().min(1),
  assetTag:       z.string().nullable().optional().default(null),
  description:    z.string().nullable().optional().default(null),
  equipmentClass: z.string().nullable().optional().default(null),
  service:        z.string().nullable().optional().default(null),
  // G1/G5: mainEquipment added — previously missing, causing Gemini output to be stripped by Zod.
  // Prompt instructs Gemini to return null unless explicitly visible on drawing.
  mainEquipment:  z.string().nullable().optional().default(null),
  location:       z.string().nullable().optional().default(null),
  unit:           z.string().nullable().optional().default(null),
  area:           z.string().nullable().optional().default(null),
  confidence:     z.number().min(0).max(1),
  bbox:           BBoxSchema,
  legendSymbol:   z.string().nullable().optional().default(null),
  evidence:       z.array(z.string()).default([]).transform(
    // M6: evidence:[] from AI must NOT discard the detection — supply a fallback.
    // min(1) was previously enforced here, causing Gemini detections with empty evidence
    // to fail Zod validation and silently drop the entire page detection result.
    // Now: empty → ['VISION_DETECTION'] sentinel. Rule validator appends real evidence later.
    arr => arr.length > 0 ? arr : ['VISION_DETECTION']
  ),
});

export const PageDetectionSchema = z.object({
  page:       z.number().int().min(1),
  detections: z.array(DetectionSchema),
});

export type Detection = z.infer<typeof DetectionSchema>;
export type PageDetection = z.infer<typeof PageDetectionSchema>;
