import { z } from "zod";

// BBox: 0-1000 normalized coordinate space.
// Accept float from AI (some models return 123.4), round at DB persist time.
export const BBoxSchema = z.object({
  x:      z.number().min(0).max(1000).transform(v => Math.round(v)),
  y:      z.number().min(0).max(1000).transform(v => Math.round(v)),
  width:  z.number().min(0).max(1000).transform(v => Math.max(1, Math.round(v))),
  height: z.number().min(0).max(1000).transform(v => Math.max(1, Math.round(v))),
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
