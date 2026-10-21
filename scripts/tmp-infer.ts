import db from "@/lib/db";

const KEYWORDS: Array<[RegExp, string]> = [
  [/\bflare\s*stack\b/i, "Flare Stack"],
  [/\bvent\s*stack\b/i, "Vent Stack"],
  [/\baerator\b/i, "Aerator"],
  [/\bwaste\s*pit\b/i, "Waste Pit"],
  [/\bshipping\s*tank\b/i, "Tank"],
  [/\bstrainer\b/i, "Strainer"],
  [/\blevel\s*gauge\b/i, "Level Gauge"],
  [/\bhorizontal\s*vessel\b/i, "Vessel"],
  [/\bvertical\s*vessel\b/i, "Vessel"],
  [/\bspectacle\s*blind\b/i, "Spectacle Blind"],
  [/\bthermowell\b/i, "Thermowell"],
  [/\bgate\s*valve\b/i, "Gate Valve"],
  [/\bglobe\s*valve\b/i, "Globe Valve"],
  [/\bball\s*valve\b/i, "Ball Valve"],
  [/\bcheck\s*valve\b/i, "Check Valve"],
  [/\bcontrol\s*valve\b/i, "Control Valve"],
  [/\borifice\b/i, "Orifice"],
  [/\bcentrifugal\s*pump\b/i, "Centrifugal Pump"],
  [/\bpump\b/i, "Pump"],
  [/\bvessel\b/i, "Vessel"],
  [/\btank\b/i, "Tank"],
  [/\bcolumn\b/i, "Column"],
  [/\bheat\s*exchanger\b/i, "Heat Exchanger"],
];

function norm(s: string) { return s.toLowerCase().replace(/\s+/g,' ').trim(); }

(async () => {
  const rows = (await db.query(`SELECT id, asset_tag, asset_type, confidence, evidence FROM detections WHERE upper(asset_type)='UNKNOWN'`)).rows as any[];
  const syms = (await db.query(`SELECT symbol_name, asset_type, tag_pattern FROM legend_symbols WHERE status='ACTIVE' AND asset_type IS NOT NULL`)).rows as any[];
  const cand = syms
    .map(s => ({ name: norm(s.symbol_name ?? ''), type: s.asset_type as string }))
    .filter(s => s.name.length >= 5)
    .sort((a,b)=>b.name.length-a.name.length);

  let byLegend=0, byKeyword=0, none=0;
  const leftovers: any[] = [];
  for (const r of rows) {
    const text = Array.isArray(r.evidence) ? r.evidence.join('\n') : String(r.evidence ?? '');
    const t = norm(text);
    let hit = cand.find(c => t.includes(c.name) && !/^(unknown|valve|instrument|other)$/i.test(c.type));
    if (hit) { byLegend++; continue; }
    const k = KEYWORDS.find(([re]) => re.test(t));
    if (k) { byKeyword++; continue; }
    none++;
    leftovers.push(r);
  }
  console.log({ total: rows.length, byLegend, byKeyword, none });
  for (const r of leftovers.slice(0, 25)) {
    const text = Array.isArray(r.evidence) ? r.evidence.join(' | ') : String(r.evidence ?? '');
    console.log(`${r.asset_tag ?? '-'} | ${r.confidence} | ${text.slice(0,180)}`);
  }
  const untagged = leftovers.filter(r => !r.asset_tag).length;
  const synthetic = leftovers.filter(r => r.asset_tag && /^UNK-/i.test(r.asset_tag)).length;
  console.log('leftover untagged', untagged, 'synthetic', synthetic);
  await db.end();
})();
