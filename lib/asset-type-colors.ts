/**
 * Per-asset-type color map for bounding box visualization.
 * Each entry: { stroke, fill (semi-transparent), label }
 */
export interface AssetTypeColor {
  stroke: string;   // full color — border, label bg
  fill: string;     // semi-transparent fill when selected
  text: string;     // label text color (always white works on dark strokes)
  label: string;    // human-readable type name
}

// Normalize asset type string for lookup
export function normalizeAssetType(assetType: string): string {
  return assetType.toLowerCase().trim();
}

// Color palette — distinct, readable on both light/dark P&ID backgrounds
const COLOR_MAP: Record<string, AssetTypeColor> = {
  // ── Rotating equipment ────────────────────────────────────────────────────
  'pump':              { stroke: '#3b82f6', fill: '#3b82f618', text: '#fff', label: 'Pump' },
  'centrifugal pump':  { stroke: '#3b82f6', fill: '#3b82f618', text: '#fff', label: 'Pump' },
  'reciprocating pump':{ stroke: '#2563eb', fill: '#2563eb18', text: '#fff', label: 'Pump' },
  'compressor':        { stroke: '#8b5cf6', fill: '#8b5cf618', text: '#fff', label: 'Compressor' },
  'blower':            { stroke: '#7c3aed', fill: '#7c3aed18', text: '#fff', label: 'Blower' },
  'fan':               { stroke: '#6d28d9', fill: '#6d28d918', text: '#fff', label: 'Fan' },
  'turbine':           { stroke: '#5b21b6', fill: '#5b21b618', text: '#fff', label: 'Turbine' },
  'motor':             { stroke: '#4c1d95', fill: '#4c1d9518', text: '#fff', label: 'Motor' },
  'agitator':          { stroke: '#7e22ce', fill: '#7e22ce18', text: '#fff', label: 'Agitator' },
  'mixer':             { stroke: '#6b21a8', fill: '#6b21a818', text: '#fff', label: 'Mixer' },
  'ejector':           { stroke: '#581c87', fill: '#581c8718', text: '#fff', label: 'Ejector' },
  'injector':          { stroke: '#4a1d96', fill: '#4a1d9618', text: '#fff', label: 'Injector' },

  // ── Static vessels ────────────────────────────────────────────────────────
  'vessel':            { stroke: '#f59e0b', fill: '#f59e0b18', text: '#fff', label: 'Vessel' },
  'tank':              { stroke: '#d97706', fill: '#d9770618', text: '#fff', label: 'Tank' },
  'column':            { stroke: '#b45309', fill: '#b4530918', text: '#fff', label: 'Column' },
  'drum':              { stroke: '#92400e', fill: '#92400e18', text: '#fff', label: 'Drum' },
  'separator':         { stroke: '#78350f', fill: '#78350f18', text: '#fff', label: 'Separator' },
  'scrubber':          { stroke: '#a16207', fill: '#a1620718', text: '#fff', label: 'Scrubber' },
  'reactor':           { stroke: '#ca8a04', fill: '#ca8a0418', text: '#fff', label: 'Reactor' },
  'absorber':          { stroke: '#eab308', fill: '#eab30818', text: '#fff', label: 'Absorber' },
  'accumulator':       { stroke: '#fbbf24', fill: '#fbbf2418', text: '#fff', label: 'Accumulator' },
  'storage tank':      { stroke: '#f97316', fill: '#f9731618', text: '#fff', label: 'Storage Tank' },

  // ── Heat transfer ─────────────────────────────────────────────────────────
  'heat exchanger':    { stroke: '#ec4899', fill: '#ec489918', text: '#fff', label: 'Heat Exchanger' },
  'condenser':         { stroke: '#db2777', fill: '#db277718', text: '#fff', label: 'Condenser' },
  'reboiler':          { stroke: '#be185d', fill: '#be185d18', text: '#fff', label: 'Reboiler' },
  'cooler':            { stroke: '#9d174d', fill: '#9d174d18', text: '#fff', label: 'Cooler' },
  'heater':            { stroke: '#831843', fill: '#83184318', text: '#fff', label: 'Heater' },
  'furnace':           { stroke: '#e11d48', fill: '#e11d4818', text: '#fff', label: 'Furnace' },
  'boiler':            { stroke: '#f43f5e', fill: '#f43f5e18', text: '#fff', label: 'Boiler' },

  // ── Valves ────────────────────────────────────────────────────────────────
  'valve':             { stroke: '#10b981', fill: '#10b98118', text: '#fff', label: 'Valve' },
  'gate valve':        { stroke: '#059669', fill: '#05966918', text: '#fff', label: 'Gate Valve' },
  'globe valve':       { stroke: '#047857', fill: '#04785718', text: '#fff', label: 'Globe Valve' },
  'ball valve':        { stroke: '#065f46', fill: '#065f4618', text: '#fff', label: 'Ball Valve' },
  'butterfly valve':   { stroke: '#064e3b', fill: '#064e3b18', text: '#fff', label: 'Butterfly Valve' },
  'check valve':       { stroke: '#34d399', fill: '#34d39918', text: '#fff', label: 'Check Valve' },
  'needle valve':      { stroke: '#6ee7b7', fill: '#6ee7b718', text: '#fff', label: 'Needle Valve' },
  'diaphragm valve':   { stroke: '#a7f3d0', fill: '#a7f3d018', text: '#000', label: 'Diaphragm Valve' },
  'control valve':     { stroke: '#0ea5e9', fill: '#0ea5e918', text: '#fff', label: 'Control Valve' },
  'cv':                { stroke: '#0ea5e9', fill: '#0ea5e918', text: '#fff', label: 'Control Valve' },
  'hand valve':        { stroke: '#16a34a', fill: '#16a34a18', text: '#fff', label: 'Hand Valve' },
  'manual valve':      { stroke: '#15803d', fill: '#15803d18', text: '#fff', label: 'Manual Valve' },
  'solenoid valve':    { stroke: '#166534', fill: '#16653418', text: '#fff', label: 'Solenoid Valve' },
  'relief valve':      { stroke: '#dc2626', fill: '#dc262618', text: '#fff', label: 'Relief Valve' },
  'psv':               { stroke: '#dc2626', fill: '#dc262618', text: '#fff', label: 'PSV' },
  'prv':               { stroke: '#b91c1c', fill: '#b91c1c18', text: '#fff', label: 'PRV' },
  'safety valve':      { stroke: '#991b1b', fill: '#991b1b18', text: '#fff', label: 'Safety Valve' },
  'rupture disk':      { stroke: '#7f1d1d', fill: '#7f1d1d18', text: '#fff', label: 'Rupture Disk' },
  'pressure safety valve': { stroke: '#dc2626', fill: '#dc262618', text: '#fff', label: 'PSV' },

  // ── Instruments ───────────────────────────────────────────────────────────
  'instrument':        { stroke: '#06b6d4', fill: '#06b6d418', text: '#fff', label: 'Instrument' },
  'transmitter':       { stroke: '#0891b2', fill: '#0891b218', text: '#fff', label: 'Transmitter' },
  'controller':        { stroke: '#0e7490', fill: '#0e749018', text: '#fff', label: 'Controller' },
  'indicator':         { stroke: '#155e75', fill: '#155e7518', text: '#fff', label: 'Indicator' },
  'analyzer':          { stroke: '#164e63', fill: '#164e6318', text: '#fff', label: 'Analyzer' },
  'sensor':            { stroke: '#22d3ee', fill: '#22d3ee18', text: '#fff', label: 'Sensor' },
  'gauge':             { stroke: '#67e8f9', fill: '#67e8f918', text: '#000', label: 'Gauge' },
  'flow meter':        { stroke: '#a5f3fc', fill: '#a5f3fc18', text: '#000', label: 'Flow Meter' },
  'level gauge':       { stroke: '#cffafe', fill: '#cffafe18', text: '#000', label: 'Level Gauge' },
  'pressure gauge':    { stroke: '#ecfeff', fill: '#ecfeff18', text: '#000', label: 'Pressure Gauge' },

  // ── Filtration / separation ───────────────────────────────────────────────
  'filter':            { stroke: '#84cc16', fill: '#84cc1618', text: '#fff', label: 'Filter' },
  'strainer':          { stroke: '#65a30d', fill: '#65a30d18', text: '#fff', label: 'Strainer' },
  'cyclone':           { stroke: '#4d7c0f', fill: '#4d7c0f18', text: '#fff', label: 'Cyclone' },
  'bag filter':        { stroke: '#3f6212', fill: '#3f621218', text: '#fff', label: 'Bag Filter' },

  // ── Misc equipment ────────────────────────────────────────────────────────
  'nozzle':            { stroke: '#64748b', fill: '#64748b18', text: '#fff', label: 'Nozzle' },
  'silencer':          { stroke: '#475569', fill: '#47556918', text: '#fff', label: 'Silencer' },
  'flame arrestor':    { stroke: '#334155', fill: '#33415518', text: '#fff', label: 'Flame Arrestor' },
};

// Fallback color for unrecognized types — gray
const FALLBACK_COLOR: AssetTypeColor = {
  stroke: '#94a3b8',
  fill: '#94a3b818',
  text: '#fff',
  label: 'Other',
};

/**
 * Get color for an asset type. Falls back to gray if not found.
 * Partial matching: "Centrifugal Pump" → matches "pump" entry as fallback.
 */
export function getAssetTypeColor(assetType: string): AssetTypeColor {
  if (!assetType) return FALLBACK_COLOR;
  const key = normalizeAssetType(assetType);

  // Exact match
  if (COLOR_MAP[key]) return COLOR_MAP[key];

  // Partial match — check if any known key is contained in the asset type string
  for (const [mapKey, color] of Object.entries(COLOR_MAP)) {
    if (key.includes(mapKey) || mapKey.includes(key)) return color;
  }

  return FALLBACK_COLOR;
}

/**
 * Get all distinct colors used in a set of asset types.
 * Used for building legend bars.
 */
export function getUsedAssetTypeColors(assetTypes: string[]): Array<{ label: string; color: AssetTypeColor }> {
  const seen = new Set<string>();
  const result: Array<{ label: string; color: AssetTypeColor }> = [];

  for (const t of assetTypes) {
    const color = getAssetTypeColor(t);
    const key = color.stroke; // use stroke as dedup key
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ label: color.label !== 'Other' ? color.label : t, color });
    }
  }

  return result;
}
