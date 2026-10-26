/**
 * Multi-Provider Vision AI Process Flow Analyzer for P&ID Documents
 *
 * Uses the active Vision AI Provider (Gemini, OpenAI, or Claude) to trace
 * physical piping connections, flow arrows, and process relationships
 * (FROM, TO, OF, SIZE, DIRECTION) across detected equipment on P&ID pages.
 */

import { getVisionProvider, type IVisionProvider } from '@/lib/ai-providers';
import { cleanMdoFieldValue } from '@/lib/mdo-description';

export interface MdoFlowRelation {
  assetTag: string;
  from: string | null;
  to: string | null;
  of: string | null;
  size: string | null;
  direction: 'INLET' | 'OUTLET' | 'UNKNOWN';
  confidence?: number;
}

export interface AnalyzePdfProcessFlowParams {
  pageImageBase64: string;
  assets: Array<{
    assetTag: string | null;
    assetType: string;
    description?: string | null;
    bboxNorm?: { x: number; y: number; width: number; height: number };
  }>;
  provider?: IVisionProvider;
}

/**
 * Normalizes flow direction string into standard enum.
 */
function normalizeDirection(dir: string | null | undefined): 'INLET' | 'OUTLET' | 'UNKNOWN' {
  if (!dir) return 'UNKNOWN';
  const u = dir.toUpperCase().trim();
  if (u.includes('INLET') || u.includes('IN') || u.includes('SUCTION') || u.includes('FEED')) return 'INLET';
  if (u.includes('OUTLET') || u.includes('OUT') || u.includes('DISCHARGE')) return 'OUTLET';
  return 'UNKNOWN';
}

/**
 * Analyzes the process flow for detected assets on a single P&ID page.
 * Returns a Map keyed by assetTag (uppercase) -> MdoFlowRelation.
 */
export async function analyzePdfProcessFlowWithAi(
  params: AnalyzePdfProcessFlowParams,
): Promise<Map<string, MdoFlowRelation>> {
  const { pageImageBase64, assets, provider: customProvider } = params;
  const results = new Map<string, MdoFlowRelation>();

  // Filter to assets that actually have an assetTag
  const validAssets = assets.filter((a) => a.assetTag && a.assetTag.trim().length > 0);
  if (validAssets.length === 0) {
    return results;
  }

  try {
    const provider = customProvider || (await getVisionProvider());

    const assetsSummary = validAssets
      .map((a, i) => {
        const box = a.bboxNorm
          ? `[x:${a.bboxNorm.x}, y:${a.bboxNorm.y}, w:${a.bboxNorm.width}, h:${a.bboxNorm.height}]`
          : 'unknown location';
        return `${i + 1}. Tag: "${a.assetTag}" | Type: ${a.assetType}${a.description ? ` (${a.description})` : ''} | Position: ${box}`;
      })
      .join('\n');

    const prompt = `You are an expert industrial Piping and Instrumentation Diagram (P&ID) process engineer.
Analyze the provided high-resolution P&ID page image and trace the physical piping lines, process connections, and flow arrows for the following equipment/assets:

TARGET ASSETS ON THIS PAGE:
${assetsSummary}

INSTRUCTIONS:
1. For each target asset, visually trace the connecting process piping lines and arrowheads on the drawing:
   - "from": Identify the upstream source equipment tag, supply line, or off-page connector (e.g., "TK-101", "SDV-1012", "HEADER-A", "FROM GRS").
   - "to": Identify the downstream destination equipment tag, discharge line, or off-page connector (e.g., "E-101", "PRESSURE TRANSMITTER A", "VENT", "SUMP TANK").
   - "of": Identify the parent header line, subsystem, or unit group it belongs to if labeled (e.g., "HEADER LINE", "METERING B", "SLUG CATCHER", or null).
   - "size": Identify the nominal pipe/valve size if labeled nearby (e.g., "1/2\"", "2\"", "4\"", or null).
   - "direction": Determine the primary flow direction ("INLET", "OUTLET", or "UNKNOWN").
2. Do NOT invent equipment tags that are not visible. If an inlet or outlet line leads off-page or has no label, indicate the line label or off-page text.
3. Return ONLY a single valid JSON object matching the following structure:
{
  "relations": [
    {
      "assetTag": "EXACT_ASSET_TAG",
      "from": "SOURCE_TAG_OR_NULL",
      "to": "DEST_TAG_OR_NULL",
      "of": "PARENT_LINE_OR_NULL",
      "size": "SIZE_OR_NULL",
      "direction": "INLET" | "OUTLET" | "UNKNOWN"
    }
  ]
}`;

    const completion = await provider.generateVisionCompletion({
      prompt,
      imageBase64: pageImageBase64,
      mimeType: 'image/png',
      responseFormat: 'json',
      temperature: 0.1,
      maxTokens: 4096,
    });

    const parsed = JSON.parse(completion.text.trim());
    const rawList = Array.isArray(parsed?.relations)
      ? parsed.relations
      : Array.isArray(parsed)
      ? parsed
      : [];

    for (const item of rawList) {
      if (!item || !item.assetTag) continue;
      const tagKey = String(item.assetTag).trim().toUpperCase();
      results.set(tagKey, {
        assetTag: item.assetTag,
        from: cleanMdoFieldValue(item.from),
        to: cleanMdoFieldValue(item.to),
        of: cleanMdoFieldValue(item.of),
        size: cleanMdoFieldValue(item.size),
        direction: normalizeDirection(item.direction),
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.85,
      });
    }

    return results;
  } catch (error) {
    console.warn(
      '[mdo-ai-analyzer] AI process flow analysis failed (falling back to spatial heuristics):',
      error instanceof Error ? error.message : error,
    );
    return results;
  }
}
