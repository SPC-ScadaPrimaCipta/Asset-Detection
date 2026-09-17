export function buildDetectionPrompt(legendSymbols: Array<{
  asset_type: string;
  symbol_name?: string | null;
  tag_pattern?: string | null;
  description?: string | null;
  aliases?: string[] | null;
}>) {
  const hasLegend = legendSymbols.length > 0;

  const legendContext = hasLegend
    ? legendSymbols
        .map((s) => {
          const displayName = s.symbol_name || s.asset_type;
          const parts: string[] = [`• ${displayName}`];
          if (s.symbol_name && s.asset_type !== s.symbol_name) parts.push(`(type: ${s.asset_type})`);
          if (s.tag_pattern) parts.push(`[tag pattern: ${s.tag_pattern}]`);
          if (s.aliases?.length) parts.push(`aliases: ${s.aliases.join(", ")}`);
          if (s.description) parts.push(`— ${s.description}`);
          return parts.join(" ");
        })
        .join("\n")
    : null;

  return `You are an expert P&ID (Piping and Instrumentation Diagram) analyst with 20+ years of industrial engineering experience. Your task is to identify and precisely locate ALL physical equipment and asset symbols in the provided P&ID image.

IMAGE: High-resolution PNG of one P&ID page, rendered at ~288 dpi. All symbols and text are clearly visible.

${hasLegend
  ? `SELECTED LEGEND — use as PRIMARY reference for symbol identification:
${legendContext}

CRITICAL NAMING RULE:
- The "assetType" field MUST use the exact name from this legend (the bullet point name above).
- If a detected symbol matches a legend entry, use that legend name exactly as the assetType.
- Do NOT use generic names like "Pump" or "Valve" if the legend has a specific name like "Centrifugal Pump" or "Gate Valve".`
  : `No legend provided. Use standard ISA 5.1 / ISO 10628 P&ID symbol conventions.`}

━━━ DETECTION TASK ━━━

Systematically scan the ENTIRE image from top-left to bottom-right. Detect EVERY equipment symbol visible — including symbols WITHOUT tags.

TAGGING RULES:
- If an asset tag (e.g. P-101, V-201A, FIC-301) is clearly visible near the symbol → set assetTag to that value
- If NO tag is visible near the symbol → set assetTag to null (do NOT skip the detection — still report it)
- Read tags carefully: preserve exact format (P-101A not p101a, XV-302 not xv302)
- Use spatial proximity: the tag closest to a symbol belongs to it

For EACH equipment symbol found, provide:
1. assetType — MUST match the legend name exactly if legend is provided. Use the exact symbol_name from legend.
2. assetTag — tag code visible near this symbol. NULL if not visible. Never invent tags.
3. confidence — 0.0 to 1.0:
   - 0.95–1.0: symbol clearly matches legend AND tag clearly readable
   - 0.80–0.94: symbol recognizable, tag partially obscured or not present
   - 0.60–0.79: symbol shape ambiguous
   - below 0.60: uncertain — include only with strong evidence
4. bbox — bounding box in 0–1000 normalized coordinate space:
   - (0,0) = top-left, (1000,1000) = bottom-right
   - x, y = top-left corner of symbol
   - width, height = size of symbol (tight fit around symbol graphic)
5. evidence — 1–3 specific observations justifying this detection
6. legendSymbol — exact legend name this symbol matches, or null

OPTIONAL (only if explicitly visible, never guess):
- description, equipmentClass, service, location, unit, area

━━━ STRICT RULES ━━━

DO:
✓ Detect EVERY distinct equipment symbol, even without a tag
✓ Detect untagged instruments, valves, equipment — assetTag = null is valid
✓ Include instruments (FIC, PIC, LIC, TIC, FT, PT, etc.)
✓ Include control valves, PSVs, check valves, isolation valves
✓ Detect each instance separately when same symbol appears multiple times
✓ Return integer bbox coordinates

DO NOT:
✗ Skip symbols just because they have no tag
✗ Invent or guess asset tags — null is correct if tag not visible
✗ Use generic type names when legend has a specific name
✗ Detect pipe lines, signal lines, flow arrows
✗ Detect title blocks, revision clouds, notes, legend tables
✗ Group separate equipment into one detection

━━━ OUTPUT FORMAT ━━━

Return ONLY this JSON, no markdown, no explanation:
{
  "page": <page_number>,
  "detections": [
    {
      "assetType": "<exact legend name>",
      "assetTag": "<tag or null>",
      "description": null,
      "equipmentClass": null,
      "service": null,
      "location": null,
      "unit": null,
      "area": null,
      "confidence": 0.92,
      "bbox": {"x": 245, "y": 380, "width": 52, "height": 48},
      "legendSymbol": "<exact legend name>",
      "evidence": ["Symbol matches legend entry", "No tag visible near symbol"]
    }
  ]
}`;
}
