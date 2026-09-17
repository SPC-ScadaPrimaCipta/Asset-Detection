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
          const parts: string[] = [`• ${s.asset_type}`];
          if (s.symbol_name) parts.push(`"${s.symbol_name}"`);
          if (s.tag_pattern) parts.push(`[tag: ${s.tag_pattern}]`);
          if (s.aliases?.length) parts.push(`aka: ${s.aliases.join(", ")}`);
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

Match every detected symbol against this legend. If a symbol closely matches a legend entry, use that asset_type.`
  : `No legend provided. Use standard ISA 5.1 / ISO 10628 P&ID symbol conventions:
• Circle with lines = Instrument (FI, PI, TI, LI, etc.)
• Circle with horizontal line = Valve actuator / Control valve
• Triangle pointing down = Safety Relief Valve (PSV/PRV)
• Two overlapping circles or D-shape = Pump / Compressor
• Cylinder = Tank / Vessel
• Rectangle with internal coil = Heat Exchanger
• Hatched rectangle = Filter / Strainer
• Motor symbol (M in circle) = Motor / Driver`}

━━━ DETECTION TASK ━━━

Systematically scan the entire image from top-left to bottom-right. For EACH equipment symbol found:

REQUIRED FIELDS:
1. assetType — equipment class. Must match legend if provided, otherwise use standard type (Pump, Valve, Vessel, Tank, Compressor, Heat Exchanger, Filter, Instrument, PSV, Control Valve, Motor, Fan, Blower, Ejector, Mixer, Separator)
2. assetTag — alphanumeric tag code visible in the image near this symbol (e.g. "P-101", "V-201A", "XV-302", "FIC-401"). Read carefully. NULL if not visible.
3. confidence — 0.0 to 1.0:
   - 0.95–1.0: symbol clearly matches legend AND tag is clearly readable
   - 0.80–0.94: symbol recognizable but tag partially obscured or inferred
   - 0.60–0.79: symbol shape ambiguous or tag not visible
   - below 0.60: uncertain — include only if you can provide strong evidence
4. bbox — bounding box in 0–1000 normalized coordinate space:
   - (0,0) = image top-left corner
   - (1000,1000) = image bottom-right corner
   - x, y = top-left of the symbol bounding box
   - width, height = size of the symbol bounding box
   - TIGHT fit: enclose just the symbol graphic, not surrounding whitespace
   - Include the tag text if it is directly adjacent and clearly belongs to this symbol
5. evidence — list of 1–3 specific observations that justify this detection (what you see in the image)
6. legendSymbol — the legend entry name this symbol matches, or null

OPTIONAL (return only if explicitly visible in image, never guess):
- description, equipmentClass, service, location, unit, area

━━━ STRICT RULES ━━━

DO:
✓ Detect every distinct equipment symbol, even small ones
✓ Read asset tags carefully — preserve exact case and format (P-101A not p101a)
✓ Use spatial proximity to associate tags: the tag nearest to a symbol belongs to it
✓ Include instruments (FIC, PIC, LIC, TIC, FT, PT, etc.) as separate detections
✓ Include inline items: control valves, PSVs, check valves, isolation valves if labeled
✓ When a symbol appears multiple times (identical equipment), detect each instance separately
✓ Return integer bbox coordinates (no decimals)

DO NOT:
✗ Invent or guess asset tags — if not clearly visible, return null
✗ Detect pipe lines, signal lines, or flow arrows as assets
✗ Detect title blocks, revision clouds, notes boxes, or legend tables as assets  
✗ Group separate equipment items into one detection
✗ Return fewer than the actual number of symbols visible

━━━ OUTPUT FORMAT ━━━

Return ONLY this JSON structure, no markdown fences, no explanations:
{
  "page": <page_number>,
  "detections": [
    {
      "assetType": "Pump",
      "assetTag": "P-101A",
      "description": null,
      "equipmentClass": null,
      "service": null,
      "location": null,
      "unit": null,
      "area": null,
      "confidence": 0.96,
      "bbox": {"x": 245, "y": 380, "width": 52, "height": 48},
      "legendSymbol": "Centrifugal Pump",
      "evidence": ["Circle with radial lines matches centrifugal pump symbol", "Tag P-101A clearly visible above symbol"]
    }
  ]
}`;
}
