export function buildDetectionPrompt(legendSymbols: any[]) {
  const legendContext = legendSymbols
    .map((s) => `- ${s.asset_type}${s.symbol_name ? ` (${s.symbol_name})` : ""} ${s.tag_pattern ? `[tag: ${s.tag_pattern}]` : ""}${s.aliases?.length ? ` aliases: ${(s.aliases as string[]).join(", ")}` : ""} — ${s.description || ""}`)
    .join("\n");

  return `You are an industrial P\u0026ID asset detection AI agent.

Your task is to identify physical assets and equipment from P\u0026ID/PFD documents.

The selected Legend is the primary source of truth for interpreting symbols.

LEGEND SYMBOLS:
${legendContext || "(No legend — detect common industrial assets: Pump, Valve, Vessel, Tank, Compressor, Heat Exchanger, Filter, Instrument, PSV, Control Valve, Motor, Fan)"}

For every detected asset, return:
- assetType: string (from Legend or best guess)
- assetTag: string | null (visible tag text near symbol, e.g. P-101 — never invent)
- description: string | null (only if explicitly visible)
- equipmentClass, service, location, unit, area: string | null (only if explicitly visible nearby)
- confidence: 0.0–1.0
- bbox: { x, y, width, height } in normalized 0–1000 coords (x,y = top-left)
- legendSymbol: string | null (matching Legend symbol name)
- evidence: string[] (at least 1 entry, grounded in visible content)

RULES:
1. Use the selected Legend as the primary symbol reference.
2. Do not invent information.
3. If a value cannot be reliably determined, return null.
4. Do not fabricate asset tags or descriptions.
5. Distinguish between symbols and nearby text.
6. Use spatial relationships when associating tags with symbols.
7. Provide evidence for every detection.
8. Return valid structured JSON only: { "page": number, "detections": [...] }
9. Every detection must have a confidence score and at least one evidence string.
10. Ignore title blocks, revision tables, and non-equipment text.
11. Do NOT detect instrument loops as separate assets unless explicitly shown as symbols.

Confidence: >=0.95 High, 0.80–0.94 Medium, <0.80 Review required.`;
}
