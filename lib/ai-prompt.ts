export function buildDetectionPrompt(legendSymbols: Array<{
  asset_type: string;
  symbol_name?: string | null;
  tag_pattern?: string | null;
  description?: string | null;
  aliases?: string[] | null;
}>) {
  const hasLegend = legendSymbols.length > 0;

  // Compact legend: "Name [tag_pattern]" — saves tokens vs bullet list
  const legendContext = hasLegend
    ? legendSymbols
        .map((s) => {
          const name = s.symbol_name || s.asset_type;
          return s.tag_pattern ? `${name} [${s.tag_pattern}]` : name;
        })
        .join(', ')
    : null;

  return `You are a P&ID asset detection AI. Detect ALL equipment symbols in the provided P&ID image.

${hasLegend
  ? `LEGEND (use exact names as assetType): ${legendContext}`
  : `No legend. Use standard types: Pump, Valve, Vessel, Tank, Compressor, Heat Exchanger, Filter, Instrument, PSV, Control Valve, Motor.`}

RULES:
- Detect EVERY equipment symbol, even those without a visible tag
- assetTag: exact tag code visible near symbol (e.g. P-101, V-201A). null if not visible — do NOT skip
- assetType: use exact legend name if matched, otherwise use standard type name
- bbox: normalized 0–1000 (NOT pixels). (0,0)=top-left, (1000,1000)=bottom-right
- confidence: 0.95+ clearly matches legend+tag, 0.80-0.94 recognizable, 0.60-0.79 uncertain
- evidence: 1-2 short observations
- Do NOT detect pipes, flow arrows, title blocks, or legend tables

OUTPUT — return ONLY this JSON, no markdown:
{"page":<n>,"detections":[{"assetType":"","assetTag":null,"confidence":0.9,"bbox":{"x":0,"y":0,"width":50,"height":50},"legendSymbol":null,"evidence":[""],"description":null,"equipmentClass":null,"service":null,"location":null,"unit":null,"area":null}]}`;
}
