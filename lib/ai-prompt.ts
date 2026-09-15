export function buildDetectionPrompt(legendSymbols: Array<{
  asset_type: string;
  symbol_name?: string | null;
  tag_pattern?: string | null;
  description?: string | null;
  aliases?: string[] | null;
}>) {
  const legendContext = legendSymbols
    .map(
      (s) =>
        `- ${s.asset_type}${s.symbol_name ? ` (${s.symbol_name})` : ""}` +
        `${s.tag_pattern ? ` [tag pattern: ${s.tag_pattern}]` : ""}` +
        `${s.aliases?.length ? ` aliases: ${s.aliases.join(", ")}` : ""}` +
        ` — ${s.description || ""}`
    )
    .join("\n");

  return `You are an expert industrial P&ID asset detection AI agent specialized in analyzing Piping and Instrumentation Diagrams.

INPUT: A high-resolution PNG image of a single P&ID page rendered at ~216 dpi. Every symbol is clearly visible.

YOUR TASK: Identify and locate ALL physical assets and equipment symbols visible in this image.

LEGEND SYMBOLS (primary reference for symbol recognition):
${legendContext || "(No legend provided — detect common industrial assets using standard P&ID conventions: Pump, Valve, Vessel, Tank, Compressor, Heat Exchanger, Filter, Instrument, PSV, Control Valve, Motor, Fan)"}

FOR EVERY DETECTED ASSET RETURN:
- assetType: string — equipment class from Legend or best match to standard P&ID convention
- assetTag: string | null — tag text visible near the symbol (e.g. "P-101", "V-201"). NEVER invent.
- description: string | null — only if explicitly visible as label text near symbol
- equipmentClass: string | null — only if explicitly visible
- service: string | null — only if explicitly visible
- location: string | null — only if explicitly visible
- unit: string | null — only if explicitly visible
- area: string | null — only if explicitly visible
- confidence: number 0.0–1.0
- bbox: { x, y, width, height } — normalized 0–1000 coordinate space
    * x, y = top-left corner of the symbol
    * width, height = symbol bounding dimensions
    * (0,0) = image top-left, (1000,1000) = image bottom-right
- legendSymbol: string | null — matched Legend symbol name
- evidence: string[] — minimum 1 entry grounded in what is visually present

DETECTION RULES:
1. Use the Legend as PRIMARY reference for identifying symbol shapes and types.
2. NEVER fabricate asset tags, descriptions, or values not visible in the image.
3. Return null for any value that cannot be reliably read.
4. Associate tags with symbols using spatial proximity — tag nearest to a symbol belongs to it.
5. Ignore title blocks, revision tables, border annotations, and general notes.
6. Do NOT detect instrument signal lines or piping runs as separate assets.
7. Do NOT group multiple distinct symbols as one asset unless they clearly form a single unit.
8. Bounding boxes must tightly enclose the symbol — they will overlay the original image.
9. Every detection must have at least one evidence string grounded in visible content.

CONFIDENCE:
- >= 0.95  Symbol clearly matches Legend + tag clearly readable → High
- 0.80–0.94  Symbol recognizable, tag partially readable or inferred → Medium
- < 0.80  Symbol ambiguous or tag not visible → Needs review

Return ONLY valid JSON, no markdown, no preamble:
{ "page": <page_number>, "detections": [ { "assetType": "...", "assetTag": "...", "description": null, "equipmentClass": null, "service": null, "location": null, "unit": null, "area": null, "confidence": 0.0, "bbox": { "x": 0, "y": 0, "width": 0, "height": 0 }, "legendSymbol": null, "evidence": ["..."] } ] }`;
}
