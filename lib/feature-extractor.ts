/**
 * Structured Feature Extractor
 *
 * Gemini Vision extracts ONLY structured visual attributes from a symbol crop.
 * Backend serializes to canonical text for deterministic embedding.
 *
 * Never embeds free-form descriptions — only structured canonical strings.
 */

import { getAiConfig } from '@/lib/ai-config';

export interface SymbolFeatures {
  shape: string;               // e.g. 'circle', 'diamond', 'rectangle', 'triangle'
  inside_text: string | null;  // e.g. 'PT', 'FIC', 'P' — letters inside symbol
  connection: string;          // e.g. 'process_line', 'instrument_line', 'none'
  line_count: number;          // number of lines connected
  filled: boolean;             // filled shape or outline only
  orientation: string;         // 'horizontal' | 'vertical' | 'diagonal' | 'any'
  category_hint: string;       // 'instrument' | 'equipment' | 'valve' | 'unknown'
  has_actuator: boolean;       // valve actuator symbol present
  has_arrow: boolean;          // flow direction arrow
  aspect_ratio: string;        // 'square' | 'wide' | 'tall'
}

const FEATURE_PROMPT = `You are an Engineering Symbol Feature Extractor.

Analyze this P&ID symbol crop and return ONLY structured visual attributes.

Return ONLY this exact JSON schema — no other text:
{
  "shape": "circle|diamond|rectangle|triangle|parallelogram|hexagon|other",
  "inside_text": "letters inside symbol OR null if none",
  "connection": "process_line|instrument_line|dashed_line|none",
  "line_count": number_of_lines_connected,
  "filled": true_if_filled_false_if_outline,
  "orientation": "horizontal|vertical|diagonal|any",
  "category_hint": "instrument|equipment|valve|safety|unknown",
  "has_actuator": true_if_actuator_symbol_visible,
  "has_arrow": true_if_flow_arrow_visible,
  "aspect_ratio": "square|wide|tall"
}

Rules:
- shape: describe the PRIMARY symbol shape only
- inside_text: extract ONLY letters/numbers inside the symbol boundary, null if none visible
- connection: type of line connecting to symbol
- line_count: count distinct lines entering/leaving the symbol (0-8)
- filled: true = solid fill, false = outline only
- Never describe surrounding context — only the symbol itself
- If attribute unclear, use most likely value
- No explanation, no markdown, ONLY JSON`;

/**
 * Extract structured features from a symbol crop image (base64 PNG).
 * Returns null if extraction fails — caller should handle gracefully.
 */
export async function extractSymbolFeatures(
  imageBase64: string
): Promise<SymbolFeatures | null> {
  try {
    const cfg = await getAiConfig();
    if (!cfg.geminiKey) return null;

    const { getGeminiClient } = await import('@/lib/gemini');
    const client = await getGeminiClient();

    const model = client.getGenerativeModel({
      model: cfg.geminiModel,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent([
      { text: FEATURE_PROMPT },
      { inlineData: { mimeType: 'image/png', data: imageBase64 } },
    ]);

    const raw = result.response.text().trim();
    const parsed = JSON.parse(raw) as SymbolFeatures;

    // Validate required fields
    if (!parsed.shape) return null;

    return {
      shape: String(parsed.shape ?? 'other').toLowerCase(),
      inside_text: parsed.inside_text ? String(parsed.inside_text).toUpperCase() : null,
      connection: String(parsed.connection ?? 'none').toLowerCase(),
      line_count: Math.max(0, Math.min(8, Number(parsed.line_count) || 0)),
      filled: Boolean(parsed.filled),
      orientation: String(parsed.orientation ?? 'any').toLowerCase(),
      category_hint: String(parsed.category_hint ?? 'unknown').toLowerCase(),
      has_actuator: Boolean(parsed.has_actuator),
      has_arrow: Boolean(parsed.has_arrow),
      aspect_ratio: String(parsed.aspect_ratio ?? 'square').toLowerCase(),
    };
  } catch (err) {
    console.warn('[feature-extractor] extraction failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Serialize structured features to canonical text representation.
 * Order is FIXED — same features always produce same string → deterministic embedding.
 *
 * Format: key=value; (semicolon-separated, sorted by key order below)
 */
export function serializeFeatures(f: SymbolFeatures): string {
  const parts: string[] = [
    `shape=${f.shape}`,
    `inside_text=${f.inside_text ?? 'none'}`,
    `connection=${f.connection}`,
    `line_count=${f.line_count}`,
    `filled=${f.filled}`,
    `orientation=${f.orientation}`,
    `category=${f.category_hint}`,
    `has_actuator=${f.has_actuator}`,
    `has_arrow=${f.has_arrow}`,
    `aspect_ratio=${f.aspect_ratio}`,
  ];
  return parts.join(';');
}

/**
 * Full pipeline: image → features → canonical string.
 * Returns null if Gemini extraction fails.
 */
export async function imageToCanonical(imageBase64: string): Promise<{
  features: SymbolFeatures;
  canonical: string;
} | null> {
  const features = await extractSymbolFeatures(imageBase64);
  if (!features) return null;
  return { features, canonical: serializeFeatures(features) };
}

/**
 * Parse canonical string back to features object (for display/debug).
 */
export function parseCanonical(canonical: string): Partial<SymbolFeatures> {
  const result: Partial<SymbolFeatures> = {};
  for (const part of canonical.split(';')) {
    const [key, val] = part.trim().split('=');
    if (!key || !val) continue;
    switch (key) {
      case 'shape': result.shape = val; break;
      case 'inside_text': result.inside_text = val === 'none' ? null : val; break;
      case 'connection': result.connection = val; break;
      case 'line_count': result.line_count = parseInt(val); break;
      case 'filled': result.filled = val === 'true'; break;
      case 'orientation': result.orientation = val; break;
      case 'category': result.category_hint = val; break;
      case 'has_actuator': result.has_actuator = val === 'true'; break;
      case 'has_arrow': result.has_arrow = val === 'true'; break;
      case 'aspect_ratio': result.aspect_ratio = val; break;
    }
  }
  return result;
}
