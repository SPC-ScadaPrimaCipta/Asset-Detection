export function buildDetectionPrompt(legendSymbols: Array<{
  asset_type: string;
  symbol_name?: string | null;
  tag_pattern?: string | null;
  description?: string | null;
  aliases?: string[] | null;
  standard_code?: string | null;
  isa_function_code?: string | null;
  iso_category?: string | null;
}>) {
  // Deduplicate by (symbol_name, asset_type) — DB may contain duplicate rows from double-import
  const _seen = new Set<string>();
  const uniqueSymbols = legendSymbols.filter(s => {
    const key = `${(s.symbol_name ?? '').trim().toLowerCase()}|${(s.asset_type ?? '').trim().toLowerCase()}`;
    if (_seen.has(key)) return false;
    _seen.add(key);
    return true;
  });

  const hasLegend = uniqueSymbols.length > 0;

  // Detect which standards are present in the legend
  const standards = [...new Set(uniqueSymbols.map(s => s.standard_code).filter(Boolean))];
  const hasISA = standards.some(s => s?.includes('ISA'));
  const hasISO = standards.some(s => s?.includes('ISO'));
  const isBuiltinStandard = standards.length > 0 && uniqueSymbols.some(s => s.standard_code);

  const legendContext = hasLegend
    ? uniqueSymbols
        .map((s) => {
          const displayName = s.symbol_name || s.asset_type;
          const parts: string[] = [`• ${displayName}`];
          if (s.symbol_name && s.asset_type !== s.symbol_name) parts.push(`(type: ${s.asset_type})`);
          if (s.tag_pattern) parts.push(`[tag pattern: ${s.tag_pattern}]`);
          if (s.aliases?.length) parts.push(`aliases: ${s.aliases.join(", ")}`);
          if (s.isa_function_code) parts.push(`[ISA code: ${s.isa_function_code}]`);
          if (s.iso_category) parts.push(`[ISO category: ${s.iso_category}]`);
          if (s.description) parts.push(`— ${s.description}`);
          return parts.join(" ");
        })
        .join("\n")
    : null;

  // Build standard-specific guidance block
  let standardGuidance = '';
  if (isBuiltinStandard) {
    const standardNames = standards.map(s => {
      if (s?.includes('ISA_5_1')) return 'ANSI/ISA-5.1-2009';
      if (s?.includes('ISO_10628_2')) return 'ISO 10628-2:2012';
      return s;
    }).filter(Boolean).join(' + ');

    standardGuidance = `
REFERENCE STANDARD: ${standardNames}
This legend is based on an industry-recognized standard. Use strict naming:`;

    if (hasISA) {
      standardGuidance += `
• ISA 5.1 instrument tags follow the pattern: [measured variable][modifier][readout][output]-[loop#]
  First letter: F=Flow, P=Pressure, T=Temperature, L=Level, A=Analysis, Z=Position, V=Vibration, S=Speed
  Subsequent: C=Controller, I=Indicator, T=Transmitter, R=Recorder, S=Switch, A=Alarm, E=Element, V=Valve
  Examples: FIC-101 (Flow Indicating Controller), PT-202 (Pressure Transmitter), LCV-303 (Level Control Valve)
• Instrument bubbles (circles) are ISA 5.1 instruments — identify them by ISA tag pattern
• Control valves have distinct body shapes with actuator symbols above/below`;
    }

    if (hasISO) {
      standardGuidance += `
• ISO 10628-2 equipment uses standardized graphical symbols:
  Vessels/tanks: cylindrical or rectangular outlines
  Pumps: circle with impeller or triangle symbol
  Compressors: circle with internal symbol
  Heat exchangers: rectangular with internal tube bundle or chevron lines
  Valves: bow-tie (gate), filled triangle (globe), circle-in-square (ball), check arrow
• Match equipment symbol SHAPE to ISO 10628-2 reference before assigning asset type`;
    }
  }

  return `You are an expert P&ID (Piping and Instrumentation Diagram) analyst with 20+ years of industrial engineering experience. Your task is to identify and precisely locate ALL physical equipment and asset symbols in the provided P&ID image.

IMAGE: High-resolution PNG of one P&ID page, rendered at ~288 dpi. All symbols and text are clearly visible.

${hasLegend
  ? `SELECTED LEGEND — use as PRIMARY reference for symbol identification:
${legendContext}
${standardGuidance}

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


/**
 * Gap-filler prompt — dipakai saat CV sudah deteksi sebagian halaman.
 * Lebih focused: Gemini hanya perlu memverifikasi + mengisi area yang CV tidak yakin.
 * Lebih hemat token daripada full scan.
 */
export function buildGapFillerPrompt(
  legendSymbols: Parameters<typeof buildDetectionPrompt>[0],
  context: {
    cvAcceptedCount: number;
    gapBboxes: Array<{ x: number; y: number; width: number; height: number }>;
    focusOnGaps: boolean;
  }
) {
  // Deduplicate sama seperti buildDetectionPrompt
  const _seen = new Set<string>();
  const uniqueSymbols = legendSymbols.filter(s => {
    const key = `${(s.symbol_name ?? '').trim().toLowerCase()}|${(s.asset_type ?? '').trim().toLowerCase()}`;
    if (_seen.has(key)) return false;
    _seen.add(key);
    return true;
  });

  const legendContext = uniqueSymbols.length > 0
    ? uniqueSymbols
        .map(s => {
          const name = s.symbol_name || s.asset_type;
          const parts = [`• ${name}`];
          if (s.symbol_name && s.asset_type !== s.symbol_name) parts.push(`(type: ${s.asset_type})`);
          if (s.tag_pattern) parts.push(`[tag: ${s.tag_pattern}]`);
          if (s.aliases?.length) parts.push(`aliases: ${s.aliases.join(', ')}`);
          return parts.join(' ');
        })
        .join('\n')
    : 'No legend provided.';

  const gapDesc = context.gapBboxes.length > 0
    ? `CV already detected ${context.cvAcceptedCount} high-confidence symbols.\n` +
      `Focus on these ${context.gapBboxes.length} uncertain area(s) (normalized 0-1000 coords):\n` +
      context.gapBboxes.map((b, i) =>
        `  Gap ${i + 1}: x=${b.x} y=${b.y} w=${b.width} h=${b.height}`
      ).join('\n')
    : `CV detected ${context.cvAcceptedCount} symbols. Scan full image for anything CV missed.`;

  return `You are an expert P&ID analyst. Computer Vision (CV) has already processed this page.
Your job: identify symbols CV missed or was uncertain about.

SELECTED LEGEND:
${legendContext}

CONTEXT:
${gapDesc}

TASK:
Detect ALL equipment symbols — especially in the gap areas above.
Do NOT re-detect areas where CV is already confident (high confidence already recorded).
Focus on: ambiguous shapes, overlapping symbols, rotated equipment, symbols near borders.

For each detection:
- assetType: exact legend name
- assetTag: visible tag or null (never invent)
- confidence: 0.0-1.0
- bbox: normalized 0-1000 coords
- evidence: 1-3 observations
- legendSymbol: matched legend entry or null

Return ONLY valid JSON:
{
  "page": <number>,
  "detections": [
    {
      "assetType": "<legend name>",
      "assetTag": "<tag or null>",
      "description": null,
      "equipmentClass": null,
      "service": null,
      "location": null,
      "unit": null,
      "area": null,
      "confidence": 0.85,
      "bbox": {"x": 200, "y": 300, "width": 60, "height": 55},
      "legendSymbol": "<legend name>",
      "evidence": ["Symbol shape matches legend", "Tag visible nearby"]
    }
  ]
}`;
}
