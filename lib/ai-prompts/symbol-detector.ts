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
  /** Present when symbols were merged from several legends — drives grouping. */
  sourceLegendName?: string | null;
  sourcePriority?: number | null;
}>, opts?: {
  referenceExamples?: Array<{ asset_type: string; symbol_name?: string | null; tag_pattern?: string | null }>;
  /** True when reference crop images are prepended before the P&ID page in the Gemini call. */
  hasReferenceCrops?: boolean;
}): string {
  const hasLegend = legendSymbols.length > 0;

  const formatSymbol = (s: {
    asset_type: string;
    symbol_name?: string | null;
    tag_pattern?: string | null;
    description?: string | null;
    aliases?: string[] | null;
  }) => {
    const name = s.symbol_name ?? s.asset_type;
    const parts = [`• ${name}`];
    if (s.tag_pattern) parts.push(`[tag: ${s.tag_pattern}]`);
    if (s.aliases?.length) parts.push(`(${s.aliases.join(', ')})`);
    if (s.description) parts.push(`— ${s.description}`);
    return parts.join(' ');
  };

  // Multi-legend grouping: symbols arrive in priority order, so grouping by
  // source preserves it. A single legend (or unmerged symbols) renders exactly
  // the legacy single block.
  const legendNames = hasLegend
    ? [...new Set(legendSymbols.map((s) => s.sourceLegendName ?? null))]
    : [];
  const multiLegend = legendNames.length > 1;
  const legendRef = hasLegend
    ? multiLegend
      ? legendNames
          .map((name, i) => {
            const group = legendSymbols.filter((s) => (s.sourceLegendName ?? null) === name);
            const label = i === 0 ? `LEGEND ${i + 1} — ${name} (primary)` : `LEGEND ${i + 1} — ${name}`;
            return `${label}:\n${group.map(formatSymbol).join('\n')}`;
          })
          .join('\n\n')
      : legendSymbols.map(formatSymbol).join('\n')
    : null;

  return `You are an expert P&ID Asset Detection AI with deep knowledge of industrial engineering drawings.

Your task: detect EVERY equipment symbol AND read EVERY asset tag on this P&ID page.

${hasLegend ? `${multiLegend ? 'LEGENDS (primary reference for symbol identification — LEGEND 1 wins every conflict between legends)' : 'LEGEND (primary reference for symbol identification)'}:
${legendRef}

IMPORTANT: If a symbol visually matches any legend entry, use that legend name as assetType even if the tag prefix is unfamiliar.${multiLegend ? ' When legends disagree, follow the lowest-numbered legend.' : ''}
` : `No legend provided. Use your knowledge of ISA 5.1 and ISO 10628-2 P&ID standards.`}
${opts?.referenceExamples?.length ? `CONFIRMED REFERENCE EXAMPLES (few-shot — symbols already approved from this legend):
${opts.referenceExamples.slice(0, 5).map(s => `• ${s.symbol_name ?? s.asset_type}${s.tag_pattern ? ` [${s.tag_pattern}]` : ''} (${s.asset_type})`).join('\n')}
Prefer these names when the symbol matches.
` : ''}${opts?.hasReferenceCrops ? `REFERENCE SYMBOL IMAGES: The images labeled "REFERENCE SYMBOL 1", "REFERENCE SYMBOL 2", etc. immediately before the P&ID page image are VISUAL EXAMPLES of legend symbols from the actual legend document. When detecting symbols on the P&ID, compare their visual shape against these reference images. A shape match to a reference image is strong evidence — use that symbol's name as assetType. Reference images take priority over text-only legend descriptions.
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

━━━ STEP 4: READ EQUIPMENT DESCRIPTORS (size, fromRef, toRef, ofOrAtRef) ━━━
For each detected asset, read equipment descriptors associated with the symbol or tag:
- size: line or equipment pipe/nozzle size if present
- fromRef: origin/source reference location or line
- toRef: destination reference location or line
- ofOrAtRef: equipment or location reference (e.g. "OF P-101" / "AT TANK-01")

━━━ TITLE BLOCK / PROJECT CODE PREFIX ━━━
Read the project code prefix from the drawing title block or drawing card. If unreadable or absent, use null for the project code prefix and mark asset for review / NEEDS_REVIEW.

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
BBOX RULES — CRITICAL:
• Draw bbox TIGHTLY around the symbol GRAPHIC only (the circle, square, triangle, valve body, pump circle, etc.)
• DO NOT include tag text (e.g. "PDT-11") inside the bbox — text is outside the symbol
• DO NOT include pipe lines, connecting lines, or signal lines inside the bbox
• DO NOT pad — the bbox edges should touch the outermost pixel of the symbol graphic
• Instrument circles: bbox should be the circle diameter, not larger
• Valves: bbox should be the valve body only, not the actuator or connecting pipes
• Typical instrument symbol bbox: width 30-80 units, height 30-80 units in 0-1000 space
• Typical valve bbox: width 20-70 units, height 20-70 units
• Typical pump/vessel bbox: width 50-150 units, height 50-150 units
• If bbox width or height exceeds 200 units for an instrument/valve, you are likely including pipe lines — shrink it

service, mainEquipment, description: use text visible near the symbol when available; otherwise use standard conventions for the detected asset type when appropriate.

━━━ OUTPUT FORMAT ━━━
Return ONLY valid JSON — no markdown, no explanation:
{
  "page": <page_number>,
  "detections": [
    {
      "assetType": "Pressure Differential Transmitter",
      "assetTag": "PDT-11",
      "tagPrefix": "PDT",
      "projectCode": <prefix read from title block / drawing card, or null if unreadable>,
      "confidence": 0.93,
      "bbox": {"x": 245, "y": 380, "width": 52, "height": 48},
      "symbolDescription": "circle with differential pressure symbol, two process connections",
      "nearbyText": "PDT-11 VERTICAL TRANSFER PUMP",
      "legendSymbol": "Pressure Transmitter",
      "service": null,
      "mainEquipment": null,
      "description": null,
      "size": null,
      "fromRef": null,
      "toRef": null,
      "ofOrAtRef": null,
      "evidence": ["Circle with DP symbol matches Pressure Differential Transmitter", "Tag PDT-11 visible directly below symbol"]
    }
  ]
}`;
}

/**
 * Region-aware variant of the symbol detector prompt.
 *
 * Identical detection rules, but the coordinate frame is the CROP the model was
 * given, not the page. The caller maps every returned bbox back to page space via
 * mapRegionBboxToPage. Keeping the rules in one shared block means a region and
 * a full-page pass cannot drift apart and produce conflicting conventions.
 */
export function buildRegionSymbolDetectorPrompt(
  legendSymbols: Array<{
    asset_type: string;
    symbol_name?: string | null;
    tag_pattern?: string | null;
    description?: string | null;
    aliases?: string[] | null;
    standard_code?: string | null;
  }>,
  regionLabel: string,
  opts: {
    referenceExamples?: Array<{ asset_type: string; symbol_name?: string | null; tag_pattern?: string | null }>;
    hasReferenceCrops?: boolean;
  } = {},
): string {
  return `${buildSymbolDetectorPrompt(legendSymbols, opts)}

━━━ COORDINATE FRAME — READ CAREFULLY ━━━
The image above is a CROPPED REGION of a larger P&ID sheet, not the whole sheet.
This crop shows region: "${regionLabel}"

- Bounding boxes MUST be in 0-1000 space RELATIVE TO THIS CROP:
  (0,0) = top-left pixel of THIS CROP, (1000,1000) = bottom-right pixel of THIS CROP.
- Do NOT return full-page coordinates. A box near 0,0 here means the top-left of
  the CROP, not of the sheet.
- Symbols cut by the crop edge: report them if you can still identify the symbol,
  using the visible portion as the box. Adjacent overlapping regions cover the
  rest, and duplicates are merged afterwards.
- A symbol may therefore be reported by more than one region. That is expected and
  handled downstream — do not try to avoid re-reporting it.

Everything else (detection rules, field rules, JSON output format) is unchanged.`;
}

/**
 * Standalone tag-listing prompt for dense pages.
 * Not wired into the current pipeline (Gemini reads tags in STEP 1 of the main
 * prompt); kept as a reusable building block.
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
