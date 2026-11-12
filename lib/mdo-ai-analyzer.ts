/**
 * Multi-Provider Vision AI Process Flow Analyzer for P&ID Documents
 *
 * Uses the active Vision AI Provider (Gemini, OpenAI, or Claude) to trace
 * physical piping connections, flow arrows, and process relationships
 * (FROM, TO, OF, SIZE, DIRECTION) across detected equipment on P&ID pages.
 */

import { getVisionProvider, type IVisionProvider } from '@/lib/ai-providers';
import { cleanMdoFieldValue, isInstrumentAsset } from '@/lib/mdo-description';

export interface MdoFlowRelation {
  assetTag: string;
  from: string | null;
  to: string | null;
  of: string | null;
  at: string | null;
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

const BATCH_SIZE = 15;

/**
 * Analyzes the process flow for detected assets on a single P&ID page.
 * Returns a Map keyed by assetTag (uppercase) -> MdoFlowRelation.
 * Processes assets in batches of 15 to prevent token truncation.
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

    // Chunk into batches of BATCH_SIZE
    const batches: Array<typeof validAssets> = [];
    for (let i = 0; i < validAssets.length; i += BATCH_SIZE) {
      batches.push(validAssets.slice(i, i + BATCH_SIZE));
    }

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      const assetsSummary = batch
        .map((a, i) => {
          const box = a.bboxNorm
            ? `[x:${a.bboxNorm.x}, y:${a.bboxNorm.y}, w:${a.bboxNorm.width}, h:${a.bboxNorm.height}]`
            : 'unknown location';
          return `${i + 1}. Tag: "${a.assetTag}" | Type: ${a.assetType}${a.description ? ` (${a.description})` : ''} | Position: ${box}`;
        })
        .join('\n');

      const prompt = `You are an expert industrial Piping and Instrumentation Diagram (P&ID) process engineer.
Analyze the provided high-resolution P&ID page image and trace physical piping lines, process connections, and flow arrows for the following equipment/assets according to PT Accenture Indonesia Description Rules:

TARGET ASSETS ON THIS PAGE (Batch ${bIdx + 1} of ${batches.length}):
${assetsSummary}

INSTRUCTIONS:
1. For each target asset, visually trace the connecting process piping lines and arrowheads on the drawing:
   - "from": Identify the upstream source equipment tag, supply line, or origin (e.g. "TK-101", "SDV-1012", "GRS", "HEADER-A", or null).
   - "to": Identify the downstream destination equipment tag, discharge line, or receiver (e.g. "VENT", "SUMP TANK", "E-101", "P-101", or null).
   - "of": Identify the parent header line, pipeline name, or system context (e.g. "HEADER LINE", "METERING B", "SLUG CATCHER", or null).
   - "at": Identify specific location or connection point if labeled (e.g. "WELLHEAD", "DISCHARGE NOZZLE", "TOP TOWER", or null).
   - "size": Identify the nominal pipe or valve size if labeled nearby (e.g. "1/2\"", "2\"", "4\"", or null).
   - "direction": Determine the primary flow direction ("INLET", "OUTLET", or "UNKNOWN").
2. CRITICAL INSTRUMENT RULE: For instruments, transmitters, gauges, and sensing devices (PT, TT, FT, LT, PI, TI, PG, TG, LG, AT, etc.): Instruments NEVER transport or discharge process fluid downstream. Therefore, "from" and "to" MUST ALWAYS BE null for instruments! For instruments, only identify "of" (parent line/header/vessel being measured), "at" (specific tapping nozzle/location), and "size".
3. Clean Omission: If any relation cannot be clearly determined from the drawing, return null. Do NOT invent fake tags.
4. Return ONLY a single valid JSON object matching this structure:
{
  "relations": [
    {
      "assetTag": "EXACT_ASSET_TAG",
      "from": "SOURCE_OR_NULL",
      "to": "DEST_OR_NULL",
      "of": "PARENT_LINE_OR_NULL",
      "at": "LOCATION_OR_NULL",
      "size": "SIZE_OR_NULL",
      "direction": "INLET" | "OUTLET" | "UNKNOWN"
    }
  ]
}`;

      try {
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
          const targetAsset = validAssets.find((a) => (a.assetTag ?? '').trim().toUpperCase() === tagKey);
          const isInst = isInstrumentAsset(targetAsset?.assetType, tagKey);
          results.set(tagKey, {
            assetTag: item.assetTag,
            from: isInst ? null : cleanMdoFieldValue(item.from),
            to: isInst ? null : cleanMdoFieldValue(item.to),
            of: cleanMdoFieldValue(item.of),
            at: cleanMdoFieldValue(item.at),
            size: cleanMdoFieldValue(item.size),
            direction: normalizeDirection(item.direction),
            confidence: typeof item.confidence === 'number' ? item.confidence : 0.85,
          });
        }
      } catch (batchErr) {
        console.warn(`[mdo-ai-analyzer] Batch ${bIdx + 1} analysis failed:`, batchErr instanceof Error ? batchErr.message : batchErr);
      }
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
