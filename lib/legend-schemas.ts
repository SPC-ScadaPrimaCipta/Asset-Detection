import { z } from "zod";

// Validates legend symbol payload; malformed data rejected before DB write.
export const LegendSymbolSchema = z.object({
  asset_type: z.string().min(1, "Asset type required").max(120),
  symbol_name: z.string().max(120).nullable().optional().default(null),
  tag_pattern: z.string().max(60).nullable().optional().default(null),
  description: z.string().max(2000).nullable().optional().default(null),
  aliases: z.array(z.string().max(80)).max(30).optional().default([]),
  status: z.enum(["ACTIVE", "DRAFT", "REJECTED"]).optional().default("ACTIVE"),
  bbox_x: z.number().int().nullable().optional().default(null),
  bbox_y: z.number().int().nullable().optional().default(null),
  bbox_w: z.number().int().nullable().optional().default(null),
  bbox_h: z.number().int().nullable().optional().default(null),
  pid_page: z.number().int().nullable().optional().default(null),
  reference_image_url: z.string().max(500).nullable().optional().default(null),
  reference_crop_hash: z.string().max(128).nullable().optional().default(null),
  review_reason: z.string().max(500).nullable().optional().default(null),
});

export const LegendSchema = z.object({
  name: z.string().min(1, "Name required").max(200),
  description: z.string().max(2000).nullable().optional().default(null),
  status: z.enum(["ACTIVE", "DRAFT"]).optional().default("ACTIVE"),
});

export type LegendSymbolInput = z.infer<typeof LegendSymbolSchema>;
export type LegendInput = z.infer<typeof LegendSchema>;

// ─── Tag pattern validation (Phase 1: cegah pattern salah ketik masuk DB) ────
// Format valid: PREFIX-### / PREFIX-*** dengan PREFIX 1-6 huruf, contoh:
//   P-###, V-###, FIC-###, PSV-###, XV-***, E-###
// Mengembalikan null jika valid, atau pesan error jika tidak valid.
// null/empty pattern diizinkan (simbol tanpa tag) → return null.
export function validateTagPattern(pattern: string | null | undefined): string | null {
  if (pattern == null || String(pattern).trim() === '') return null;
  const p = String(pattern).trim().toUpperCase();
  if (p.length > 60) return 'Tag pattern too long (max 60 chars)';
  // Pola: 1-6 huruf, dash, 1-6 campuran #/*/digit, opsional suffix huruf
  if (!/^[A-Z]{1,6}-[\#\*\d]{1,6}[A-Z]{0,2}$/.test(p)) {
    return 'Invalid tag pattern — expected format like P-###, FIC-###, XV-***';
  }
  return null;
}
