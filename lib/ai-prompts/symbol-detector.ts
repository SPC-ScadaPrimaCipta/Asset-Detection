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

CRITICAL — assetType MUST be the EXACT name from the legend list above (copy-paste verbatim).
• If a symbol matches "Gate Valve" in the legend → assetType must be "Gate Valve", NOT "Valve" or "Ball Valve".
• If a symbol matches "Pressure Differential Transmitter" → use exactly "Pressure Differential Transmitter".
• Do NOT substitute a generic ISA/ISO name when a legend entry matches — the legend name wins ALWAYS.
• If unsure between two legend entries, pick the one whose description or tag pattern best fits.${multiLegend ? ' When legends disagree, follow the lowest-numbered legend.' : ''}
` : `No legend provided. Use your knowledge of ISA 5.1 and ISO 10628-2 P&ID standards.`}

COMMON SPECIALTY EQUIPMENT — detect these even when not in legend:
• Pig Launcher (tag prefix PL-): cylindrical vessel with closure head, launching barrel, kicker line — assetType "Pig Launcher"
• Pig Receiver (tag prefix PR-): similar to launcher but with receiver trap — assetType "Pig Receiver"
• Mixer / Static Mixer (tag prefix MX-): inline mixing element symbol or vessel with agitator — assetType "Mixer"
• Slug Catcher: large multi-finger or single vessel for slug separation — assetType "Slug Catcher"
• Production Storage Tank (tag prefix T-): open-top or fixed-roof cylinder — assetType "Storage Tank"
If these appear and no legend entry matches, use the assetType names above and set confidence 0.70-0.80.
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
On dense pages (>20 symbols): scan EVERY ROW from top to bottom — do NOT stop early.
CRITICAL: You MUST detect ALL symbols on this page. Missing a symbol is a permanent data loss.
Do NOT stop generating before you reach the bottom of the image.
If you feel the output is getting long, that is expected — a dense P&ID has 50-100+ assets. Continue until the last row.

IGNORE THESE — NOT ASSET TAGS:
• Valve status annotations: NC, NO, FC, FO, LC, LO — these mean Normally Closed/Open, Fail Closed/Open, Lock Closed/Open. They describe valve state, NOT an asset tag.
• Cross-sheet references: any text matching "TO [EQUIPMENT] SHEET N", "FROM [EQUIPMENT] SHEET N", "SHEET N OF N", "SEE SHEET N" — these are navigation references, not assets on this sheet.
• Equipment specification blocks: multi-line text blocks containing SIZE, DESIGN PRESS, DESIGN TEMP, OPERATING PRESS, OPERATING TEMP — these are specification data for the named vessel/equipment above them, not separate asset tags.

━━━ STEP 2: DETECT ALL SYMBOLS ━━━
Scan systematically top-left → bottom-right, ROW BY ROW. Do NOT stop after finding 20-30 symbols.
IMPORTANT: A full P&ID page typically contains 40-120 distinct assets. Keep scanning until you reach the absolute bottom-right corner of the image. Stopping early = permanent data loss that cannot be recovered.
Detect EVERY distinct equipment symbol — instruments, valves, pumps, vessels, junction boxes, panels, fire & gas devices, safety devices.
For each symbol, look in ALL directions (above, below, left, right, diagonal) within ~100px for its associated tag.
The tag is usually the closest alphanumeric label that is NOT a pipe size (e.g. "6\"" or "DN150") or a line number.

━━━ STEP 3: SPATIAL TAG ASSOCIATION ━━━
For EACH symbol:
- Check all text within 120px radius of the symbol center
- The closest tag that matches industrial naming convention is the asset tag
- If two symbols are close, assign each tag to its spatially nearest symbol
- Tags positioned directly above, below, or beside a symbol belong to that symbol
- SKIP text that is a valve status (NC/NO/FC/FO/LC/LO), pipe spec, or part of an equipment specification block (SIZE / DESIGN PRESS / TEMP / OPERATING) even if it appears nearby — these do not become assetTag

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
✓ Small inline valves: drain valves, vent valves, bleeder valves, sample valves, gauge root valves (typically 1/2", 3/4", 1", or attached below caps/blinds/flanges). Report them even if untagged or labeled only with pipe size (e.g. "3/4\"", "1/2\"", "3/4\" CAP") — set assetTag=null and report size in descriptors
✓ Closely-spaced adjacent valves: when two valves sit along the same line or branch (e.g. a main block valve and a drain/bleed valve on the drop leg below it), detect EACH as a SEPARATE asset with its own bbox. Do NOT merge them into one detection
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
✗ Valve status text: NC, NO, FC, FO, LC, LO — these are operating status labels on valves, not asset tags
✗ Cross-sheet navigation text: "TO [TAG] SHEET N", "FROM [TAG] SHEET N", "SHEET N OF N" — the equipment these reference lives on another sheet, do not create a detection for it on this sheet
✗ Equipment specification blocks: text blocks with SIZE / DESIGN PRESS / DESIGN TEMP / OPERATING PRESS / OPERATING TEMP — do not associate these lines as asset tags; they describe the parent vessel/equipment already detected above them
✗ Approval/revision stamps: APPROVED, NOT APPROVED, APPROVED AS NOTE, FOR INFORMATION boxes in title block or drawing card

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
• Small valve / drain / vent bbox: width 8-30 units, height 8-30 units
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
- Scan ALL content within this crop completely, top-left → bottom-right. Do NOT stop early — even a small region crop can contain 10-30 symbols.

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
