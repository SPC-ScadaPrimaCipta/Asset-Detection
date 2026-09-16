import { z } from "zod";

// Validates legend symbol payload; malformed data rejected before DB write.
export const LegendSymbolSchema = z.object({
  asset_type:  z.string().min(1, "Asset type required").max(120),
  symbol_name: z.string().max(120).nullable().optional().default(null),
  tag_pattern: z.string().max(60).nullable().optional().default(null),
  description: z.string().max(2000).nullable().optional().default(null),
  aliases:     z.array(z.string().max(80)).max(30).optional().default([]),
  status:      z.enum(["ACTIVE", "DRAFT", "REJECTED"]).optional().default("ACTIVE"),
  // Bbox — PDF coordinate space, origin bottom-left, scale=1
  bbox_x:      z.number().nullable().optional().default(null),
  bbox_y:      z.number().nullable().optional().default(null),
  bbox_w:      z.number().nullable().optional().default(null),
  bbox_h:      z.number().nullable().optional().default(null),
  pid_page:    z.number().int().positive().nullable().optional().default(null),
});

export const LegendSchema = z.object({
  name:        z.string().min(1, "Name required").max(200),
  description: z.string().max(2000).nullable().optional().default(null),
  status:      z.enum(["ACTIVE", "DRAFT"]).optional().default("ACTIVE"),
});

export type LegendSymbolInput = z.infer<typeof LegendSymbolSchema>;
export type LegendInput = z.infer<typeof LegendSchema>;
