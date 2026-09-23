/**
 * Symbol Detector Agent Prompt
 * Task: Detect all equipment symbols in a P&ID page image.
 * This is the primary detection step — runs before rule validation.
 */

export function buildSymbolDetectorPrompt(legendSymbols: Array<{
  asset_type: string;
  symbol_name?: string | null;
  tag_pattern?: string | null;
  description?: string | null;
  aliases?: string[] | null;
  standard_code?: string | null;
}>, opts?: {
  knownTags?: string[];
  referenceExamples?: Array<{ asset_type: string; symbol_name?: string | null; tag_pattern?: string | null }>;
}): string {
  const hasLegend = legendSymbols.length > 0;

  const legendRef = hasLegend
    ? legendSymbols.map(s => {
        const name = s.symbol_name ?? s.asset_type;
        const parts = [`• ${name}`];
        if (s.tag_pattern) parts.push(`[tag: ${s.tag_pattern}]`);
        if (s.aliases?.length) parts.push(`(${s.aliases.join(', ')})`);
        if (s.description) parts.push(`— ${s.description}`);
        return parts.join(' ');
      }).join('\n')
    : null;

  return `You are an expert P&ID Asset Detection AI with deep knowledge of industrial engineering drawings.

Your task: detect EVERY equipment symbol AND read EVERY asset tag on this P&ID page.

${hasLegend ? `LEGEND (primary reference for symbol identification):
${legendRef}

IMPORTANT: If a symbol visually matches any legend entry, use that legend name as assetType even if the tag prefix is unfamiliar.
` : `No legend provided. Use your knowledge of ISA 5.1 and ISO 10628-2 P&ID standards.`}
${opts?.referenceExamples?.length ? `CONFIRMED REFERENCE EXAMPLES (few-shot — symbols already approved from this legend):
${opts.referenceExamples.slice(0, 5).map(s => `• ${s.symbol_name ?? s.asset_type}${s.tag_pattern ? ` [${s.tag_pattern}]` : ''} (${s.asset_type})`).join('\n')}
Prefer these names when the symbol matches.
` : ''}${opts?.knownTags?.length ? `KNOWN TAGS on this project (prefer exact match when visible):
${opts.knownTags.slice(0, 40).join(', ')}
` : ''}
━━━ STEP 1: READ ALL TEXT FIRST ━━━
Before detecting symbols, read EVERY alphanumeric tag visible on this drawing.
Tags follow patterns like: PDT-11, PSV-101, H-001, JB-03, LCP, MCFA, PI-101, FT-201.
Tags are typically: 2-6 uppercase letters + hyphen + 2-4 digits.
Read tags even if text is small, rotated, or partially obscured.
Write down mentally all tags you see before assigning them to symbols.
On dense pages (>20 symbols): list tags first, then assign — do NOT skip trailing rows.

━━━ STEP 2: DETECT ALL SYMBOLS ━━━
Scan systematically top-left → bottom-right.
Detect EVERY distinct equipment symbol — instruments, valves, pumps, vessels, junction boxes, panels, fire & gas devices, safety devices.
For each symbol, look in ALL directions (above, below, left, right, diagonal) within ~100px for its associated tag.
The tag is usually the closest alphanumeric label that is NOT a pipe size (e.g. "6\"" or "DN150") or a line number.

━━━ STEP 3: SPATIAL TAG ASSOCIATION ━━━
For EACH symbol:
- Check all text within 120px radius of the symbol center
- The closest tag that matches industrial naming convention is the asset tag
- If two symbols are close, assign each tag to its spatially nearest symbol
- Tags positioned directly above, below, or beside a symbol belong to that symbol

━━━ DETECTION RULES ━━━

WHAT TO DETECT:
✓ All instruments (transmitters, indicators, controllers, switches, analyzers)
✓ All valves (gate, ball, check, control, safety, solenoid, butterfly)
✓ All rotating equipment (pumps, compressors, fans, turbines)
✓ All vessels, tanks, separators, filters, strainers
✓ Junction boxes (JB), local control panels (LCP), fire & gas detectors
✓ Safety devices (PSV, PRV, rupture discs)
✓ Specialty items (hose reels, silencers, flame arrestors)
✓ Symbols WITHOUT readable tags — set assetTag=null, still report them

DO NOT DETECT:
✗ Pipe lines, flow arrows, signal lines, utility headers
✗ Title blocks, revision clouds, drawing borders, north arrows
✗ Text-only annotations without an associated symbol
✗ Pipe sizes like "6\\" or "DN150" — these are NOT asset tags

━━━ FIELD RULES ━━━

assetTag:
- Extract the EXACT tag text from the drawing (e.g. "PDT-11", "H-001", "JB-03")
- Include hyphens and numbers as written (e.g. "PSV-PDT-11" if that is what is written)
- null ONLY if truly no tag text exists near the symbol
- NEVER fabricate a tag — copy exactly what is written

assetType:
- Match to legend entry if possible
- Otherwise use standard type: "Pressure Transmitter", "Gate Valve", "Centrifugal Pump", etc.

confidence:
- 0.95+: symbol clear + tag clearly readable
- 0.80-0.94: symbol clear, tag partial
- 0.65-0.79: symbol identified, no tag
- below 0.65: uncertain — include only with strong visual evidence

bbox: normalized 0-1000 space. x_norm = (x_pixel / image_width) × 1000.
Draw bbox TIGHTLY around the symbol graphic only, not including the tag text.

service, mainEquipment, description: null unless explicitly printed as text on the drawing near the symbol. NEVER infer from context.

━━━ OUTPUT FORMAT ━━━
Return ONLY valid JSON — no markdown, no explanation:
{
  "page": <page_number>,
  "detections": [
    {
      "assetType": "Pressure Differential Transmitter",
      "assetTag": "PDT-11",
      "tagPrefix": "PDT",
      "confidence": 0.93,
      "bbox": {"x": 245, "y": 380, "width": 52, "height": 48},
      "symbolDescription": "circle with differential pressure symbol, two process connections",
      "nearbyText": "PDT-11 VERTICAL TRANSFER PUMP",
      "legendSymbol": "Pressure Transmitter",
      "service": null,
      "mainEquipment": null,
      "description": null,
      "evidence": ["Circle with DP symbol matches Pressure Differential Transmitter", "Tag PDT-11 visible directly below symbol"]
    }
  ]
}`;
}

/**
 * Phase 3: Pass-1 tag-listing prompt for dense pages (2-pass detection).
 * Pass 1 returns ONLY the tag list; Pass 2 (buildSymbolDetectorPrompt with
 * knownTags) assigns tags to symbols. Aktif via DETECTION_TWO_PASS=true
 * atau otomatis untuk halaman padat (diputuskan di ai-agent/worker).
 */
export function buildTagListPrompt(): string {
  return `You are a P&ID tag reader. Read EVERY alphanumeric asset tag visible on this P&ID page image.

Tags follow patterns like: PDT-11, PSV-101, H-001, JB-03, PI-101, FT-201, FIC-201A.
Tags are typically 1-6 uppercase letters + hyphen + 1-5 digits + optional 1-2 letter suffix.
Ignore pipe sizes (6", DN150), line numbers, and title-block text.

Return ONLY valid JSON — no markdown, no explanation:
{
  "tags": ["PDT-11", "H-001", "JB-03"]
}`;
}
