import { z } from "zod";

export const BBoxSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});

export const DetectionSchema = z.object({
  assetType: z.string().min(1),
  assetTag: z.string().nullable().optional().default(null),
  description: z.string().nullable().optional().default(null),
  equipmentClass: z.string().nullable().optional().default(null),
  service: z.string().nullable().optional().default(null),
  location: z.string().nullable().optional().default(null),
  unit: z.string().nullable().optional().default(null),
  area: z.string().nullable().optional().default(null),
  confidence: z.number().min(0).max(1),
  bbox: BBoxSchema,
  legendSymbol: z.string().nullable().optional().default(null),
  evidence: z.array(z.string()).min(1),
});

export const PageDetectionSchema = z.object({
  page: z.number().int().min(1),
  detections: z.array(DetectionSchema),
});

export type Detection = z.infer<typeof DetectionSchema>;
export type PageDetection = z.infer<typeof PageDetectionSchema>;

// ponytail: add field-level confidence breakdown when multi-model ensemble needed
