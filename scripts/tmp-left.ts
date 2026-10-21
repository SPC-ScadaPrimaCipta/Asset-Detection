import db from "@/lib/db";
(async () => {
  const rows = (await db.query(`SELECT asset_tag, confidence, evidence FROM detections WHERE upper(asset_type)='UNKNOWN' AND asset_tag IS NOT NULL`)).rows as any[];
  const syms = (await db.query(`SELECT symbol_name, asset_type FROM legend_symbols WHERE status='ACTIVE' AND asset_type IS NOT NULL`)).rows as any[];
  const cand = syms.map(s=>({n:(s.symbol_name??'').toLowerCase().trim(),t:s.asset_type})).filter(s=>s.n.length>=5).sort((a,b)=>b.n.length-a.n.length);
  const KW=[/flare\s*stack/i,/vent\s*stack/i,/aerator/i,/waste\s*pit/i,/shipping\s*tank/i,/strainer/i,/level\s*gauge/i,/horizontal\s*vessel/i,/vertical\s*vessel/i,/spectacle\s*blind/i,/thermowell/i,/gate\s*valve/i,/globe\s*valve/i,/ball\s*valve/i,/check\s*valve/i,/control\s*valve/i,/orifice/i,/centrifugal\s*pump/i,/pump/i,/vessel/i,/tank/i,/column/i,/heat\s*exchanger/i];
  for (const r of rows) {
    const t=(Array.isArray(r.evidence)?r.evidence.join('\n'):String(r.evidence??'')).toLowerCase();
    const legend=cand.some(c=>t.includes(c.n));
    const kw=KW.some(re=>re.test(t));
    if (!legend && !kw) console.log(`${r.asset_tag} | ${r.confidence} | ${(Array.isArray(r.evidence)?r.evidence.join(' | '):r.evidence).slice(0,200)}`);
  }
  await db.end();
})();
