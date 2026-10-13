import fs from 'fs';
import path from 'path';

const REPO_ROOT = process.cwd();
const FULL_PAGE_HTML = path.join(REPO_ROOT, 'fixtures/diagnostics/tuning-experiments/review-package/full-page/index.html');
const SOURCE_IMG_PATH = path.join(REPO_ROOT, 'fixtures/diagnostics/tuning-experiments/review-package/full-page/sheet-1-p1_original.png');
const OVERLAY_IMG_PATH = path.join(REPO_ROOT, 'fixtures/diagnostics/tuning-experiments/review-package/full-page/04_geo2_tile1280_overlay.png');
const OUT_DIR = path.join(REPO_ROOT, 'fixtures/diagnostics/tuning-experiments/review-package/geo2-yolo-only');

if (!fs.existsSync(FULL_PAGE_HTML)) {
  console.error('[BLOCKER] File full-page/index.html tidak ditemukan:', FULL_PAGE_HTML);
  process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// 1. Ekstrak data 87 GEO-2 dan 19 Missed Baseline
const fullPageContent = fs.readFileSync(FULL_PAGE_HTML, 'utf8');
const match = fullPageContent.match(/const data = (\{.*?\});\n/s);
if (!match) {
  console.error('[BLOCKER] Gagal mengekstrak data dari full-page/index.html');
  process.exit(1);
}
const fullPageData = JSON.parse(match[1]);
const geo2Config = fullPageData.configs.geo2;
const geo2Items = geo2Config.items;
const missedBaselineItems = geo2Config.missedBaseline;

console.log(`Berhasil memuat ${geo2Items.length} kandidat GEO-2 dan ${missedBaselineItems.length} missed baseline.`);

// 2. Salin gambar original dan overlay ke folder baru (zero modification)
const copiedOriginal = path.join(OUT_DIR, 'sheet-1-p1_original.png');
const copiedOverlay = path.join(OUT_DIR, '01_geo2_tile1280_overlay.png');
fs.copyFileSync(SOURCE_IMG_PATH, copiedOriginal);
fs.copyFileSync(OVERLAY_IMG_PATH, copiedOverlay);

// 3. Kategorisasi Kandidat untuk Review
// - Matched (34): Konsisten dengan baseline 60 (IoU >= 0.75)
// - Shift (7): BBox boundary shift terhadap baseline 60 (0.40 <= IoU < 0.75)
// - Added (46): Kandidat tambahan baru
// - Suspect Text (5): Orifice / instrumen mikro pada garis alir yang rawan false-positive terhadap teks/dimensi
const suspectTextIds = new Set(['G2-12', 'G2-14', 'G2-24', 'G2-61', 'G2-81']);

const processedCandidates = geo2Items.map((item) => {
  const isSuspectText = suspectTextIds.has(item.id);
  let reviewCategory = item.category; // 'matched' | 'shift' | 'added'
  let categoryNotes = '';

  if (item.category === 'matched') {
    categoryNotes = `Konsisten dengan Baseline ${item.matchedId} (IoU ${item.iou}, kelas sama)`;
  } else if (item.category === 'shift') {
    categoryNotes = `Pergeseran batas BBox terhadap Baseline ${item.matchedId} (IoU ${item.iou}, kelas sama)`;
  } else if (item.category === 'added') {
    categoryNotes = 'Kandidat tambahan baru pada Tile 1280';
  }

  if (isSuspectText) {
    categoryNotes += ' [DUGAAN FP TEKS: Simbol orifice/fitting mikro pada garis alir/anotasi teks]';
  }

  return {
    ...item,
    isSuspectText,
    categoryNotes,
    humanDecisionSlot: {
      status: 'UNRESOLVED',
      options: ['benar', 'salah_fp_teks', 'salah_kelas', 'duplikat', 'bbox_salah', 'unresolved'],
      humanDecision: null,
      reviewerNotes: null,
    },
  };
});

const processedMissed = missedBaselineItems.map((item, idx) => ({
  ...item,
  index: idx + 1,
  category: 'missed_baseline',
  categoryNotes: `Lokasi simbol baseline (${item.rawLabel}) yang tidak terdeteksi pada konfigurasi GEO-2 Tile 1280`,
  humanDecisionSlot: {
    status: 'UNRESOLVED',
    options: ['benar_missing', 'bukan_simbol', 'unresolved'],
    humanDecision: null,
    reviewerNotes: null,
  },
}));

// 4. Generate JSON Manifest
const manifestPayload = {
  schemaVersion: 'geo2-yolo-only-review-v1',
  generatedAt: new Date().toISOString(),
  pipelineConfiguration: {
    model: 'model/yolo-pid-v8n-203.onnx',
    inputShape: '[1, 3, 1024, 1024] (FIXED)',
    pageId: 'sheet-1-p1',
    sourceImage: 'sheet-1-p1_original.png',
    sourceDimensions: '3573 x 2526 px',
    renderDpi: '216 DPI (Scale 3.0 dari PDF A3 landscape)',
    tileSize: 1280,
    stride: 1024,
    overlapPercent: 20.0,
    confidenceThreshold: 0.50,
    perTileNmsIou: 0.70,
    globalMergeIou: 0.50,
    classAware: true,
    totalTilesComputed: 12,
    rawCandidatesBeforeMerge: 152,
    retainedDetections: 87,
    suppressedCount: 65,
  },
  reviewSummary: {
    totalYoloCandidates: processedCandidates.length,
    matchedWithBaseline: processedCandidates.filter((c) => c.category === 'matched').length,
    shiftBoundaryCandidates: processedCandidates.filter((c) => c.category === 'shift').length,
    addedCandidates: processedCandidates.filter((c) => c.category === 'added').length,
    suspectTextCandidates: processedCandidates.filter((c) => c.isSuspectText).length,
    missedBaselineLocations: processedMissed.length,
    humanReviewStatus: 'ALL_UNRESOLVED',
  },
  candidates: processedCandidates,
  missedBaseline: processedMissed,
};

fs.writeFileSync(path.join(OUT_DIR, 'geo2-yolo-manifest.json'), JSON.stringify(manifestPayload, null, 2), 'utf8');

// 5. Generate CSV Manifest
const csvRows = [
  [
    'ID',
    'Tipe Objek',
    'Label Prediksi',
    'Confidence',
    'Kategori Komparasi',
    'X1',
    'Y1',
    'X2',
    'Y2',
    'Dugaan FP Teks?',
    'Catatan Sistem',
    'Keputusan Manusia (UNRESOLVED)',
    'Catatan Reviewer',
  ].join(','),
];

for (const c of processedCandidates) {
  csvRows.push([
    c.id,
    'Kandidat GEO-2',
    `"${c.rawLabel}"`,
    (c.confidence * 100).toFixed(1) + '%',
    c.category,
    Math.round(c.box.x1),
    Math.round(c.box.y1),
    Math.round(c.box.x2),
    Math.round(c.box.y2),
    c.isSuspectText ? 'YA' : 'TIDAK',
    `"${c.categoryNotes}"`,
    'UNRESOLVED',
    '""',
  ].join(','));
}

for (const m of processedMissed) {
  csvRows.push([
    m.id,
    'Lokasi Referensi Missing',
    `"${m.rawLabel}"`,
    (m.confidence * 100).toFixed(1) + '%',
    'missed_baseline',
    Math.round(m.box.x1),
    Math.round(m.box.y1),
    Math.round(m.box.x2),
    Math.round(m.box.y2),
    'N/A',
    `"${m.categoryNotes}"`,
    'UNRESOLVED',
    '""',
  ].join(','));
}

fs.writeFileSync(path.join(OUT_DIR, 'geo2-yolo-manifest.csv'), csvRows.join('\n'), 'utf8');

// 6. Generate Markdown Manifest
const mdContent = `# Paket Review Human Review — YOLO GEO-2 Only (sheet-1-p1)

**Halaman Sumber:** \`fixtures/pid-eval/sheet-1/page_1.png\` (3573×2526 px, 216 DPI)  
**Model:** \`model/yolo-pid-v8n-203.onnx\` [1, 3, 1024, 1024]  
**Konfigurasi GEO-2:** Tile 1280×1280, Stride 1024 (Overlap 20%), Conf 0.50, NMS per-tile 0.70 CA, Global Merge 0.50 CA  
**Status Evaluasi:** **100% UNRESOLVED** (Seluruh keputusan manusia kosong menunggu verifikasi visual)  

---

### Ringkasan Inventarisasi Kandidat
- **Total Deteksi GEO-2:** **87 kandidat**
  - **Konsisten dengan Baseline (Matched):** **34 kandidat** (IoU $\\ge 0.75$, kelas sama)
  - **Pergeseran Batas BBox (Shift):** **7 kandidat** ($0.40 \\le \\text{IoU} < 0.75$, kelas sama)
  - **Kandidat Tambahan Baru (Added):** **46 kandidat** (IoU $< 0.40$)
  - **Dugaan False Positive Teks / Anotasi:** **5 kandidat** (Orifice / instrumen mikro pada garis alir)
- **Lokasi Referensi Baseline Missing:** **19 lokasi** (Simbol baseline yang tidak terdeteksi oleh GEO-2)

---

### Panduan Opsi Keputusan Reviewer
Reviewer dapat memilih salah satu opsi berikut:
- \`[ ] benar\`: Simbol fisik P&ID benar, tipe kelas cocok, dan bounding box akurat.
- \`[ ] salah_fp_teks\`: False Positive teks (teks tag alfanumerik, dimensi garis pipa, atau panah alir).
- \`[ ] salah_kelas\`: Simbol fisik ada, tetapi label kelas model keliru.
- \`[ ] duplikat\`: Objek yang sama telah diwakili oleh kotak lain.
- \`[ ] bbox_salah\`: Kelas benar, namun batas kotak terpotong atau terlalu longgar.
- \`[ ] unresolved\`: Belum dapat diputuskan (memerlukan verifikasi master legend).

---

### Tabel 1: Kandidat Deteksi GEO-2 (87 Item)

| ID | Label Prediksi & Conf | Koordinat BBox (X1, Y1, X2, Y2) | Kategori | Dugaan FP Teks? | Catatan Sistem | Keputusan Manusia |
|---|---|---|:---:|:---:|---|---|
${processedCandidates.map((c) => `| **${c.id}** | \`${c.rawLabel}\`<br>(${(c.confidence * 100).toFixed(1)}%) | \`${Math.round(c.box.x1)}, ${Math.round(c.box.y1)}, ${Math.round(c.box.x2)}, ${Math.round(c.box.y2)}\` | \`${c.category}\` | ${c.isSuspectText ? '⚠️ YA' : 'Tidak'} | ${c.categoryNotes} | [ ] benar<br>[ ] salah_fp_teks<br>[ ] salah_kelas<br>[ ] duplikat<br>[ ] bbox_salah<br>[x] unresolved |`).join('\n')}

---

### Tabel 2: Lokasi Referensi Missing Baseline (19 Item)

| ID Referensi | Label Ground-Truth & Conf | Koordinat BBox (X1, Y1, X2, Y2) | Status Deteksi GEO-2 | Keputusan Manusia |
|---|---|---|---|---|
${processedMissed.map((m) => `| **${m.id}** | \`${m.rawLabel}\`<br>(${(m.confidence * 100).toFixed(1)}%) | \`${Math.round(m.box.x1)}, ${Math.round(m.box.y1)}, ${Math.round(m.box.x2)}, ${Math.round(m.box.y2)}\` | **TIDAK TERDETEKSI (IoU = 0)** | [ ] benar_missing<br>[ ] bukan_simbol<br>[x] unresolved |`).join('\n')}
`;

fs.writeFileSync(path.join(OUT_DIR, 'geo2-yolo-manifest.md'), mdContent, 'utf8');

// 7. Generate Standalone Offline HTML Viewer
const htmlViewer = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Paket Review YOLO GEO-2 Only — sheet-1-p1</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; z-index: 10; flex-shrink: 0; }
    .header-left { display: flex; align-items: center; gap: 16px; }
    .badge-yolo { background: #0284c7; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    h1 { font-size: 16px; font-weight: 600; color: #f1f5f9; }
    .header-stats { display: flex; gap: 16px; font-size: 12px; }
    .stat-box { display: flex; flex-direction: column; align-items: flex-start; }
    .stat-label { color: #94a3b8; font-size: 10px; text-transform: uppercase; }
    .stat-val { font-weight: 700; color: #38bdf8; }
    .main-layout { display: flex; flex: 1; height: calc(100vh - 61px); overflow: hidden; }
    
    /* Viewport */
    .canvas-container { flex: 1; position: relative; background: #090d16; overflow: hidden; cursor: grab; }
    .canvas-container:active { cursor: grabbing; }
    .stage { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
    .base-img { display: block; width: 3573px; height: 2526px; user-select: none; pointer-events: none; }
    .svg-overlay { position: absolute; top: 0; left: 0; width: 3573px; height: 2526px; pointer-events: none; }
    
    /* Toolbar controls */
    .floating-toolbar { position: absolute; bottom: 20px; left: 20px; background: rgba(30, 41, 59, 0.95); border: 1px solid #475569; border-radius: 8px; padding: 6px 10px; display: flex; gap: 8px; z-index: 20; box-shadow: 0 10px 25px rgba(0,0,0,0.5); backdrop-filter: blur(8px); }
    .btn { background: #334155; color: #f8fafc; border: 1px solid #475569; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
    .btn:hover { background: #475569; }
    .btn-primary { background: #0284c7; border-color: #0369a1; }
    .btn-primary:hover { background: #0369a1; }

    /* Sidebar list */
    .sidebar { width: 440px; background: #1e293b; border-left: 1px solid #334155; display: flex; flex-direction: column; z-index: 10; flex-shrink: 0; }
    .sidebar-header { padding: 14px 16px; border-bottom: 1px solid #334155; }
    .tab-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    .tab-pill { background: #334155; border: 1px solid transparent; color: #94a3b8; font-size: 11px; padding: 4px 10px; border-radius: 20px; cursor: pointer; font-weight: 600; }
    .tab-pill.active { background: #0284c7; color: #fff; }
    .cand-list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .cand-card { background: #0f172a; border: 1px solid #334155; border-left: 4px solid #64748b; border-radius: 6px; padding: 10px 12px; cursor: pointer; transition: all 0.15s; }
    .cand-card:hover { border-color: #0284c7; background: #172554; }
    .cand-card.active { border-color: #38bdf8; background: #1e3a8a; }
    .cand-card.matched { border-left-color: #00cc44; }
    .cand-card.added { border-left-color: #0088ff; }
    .cand-card.shift { border-left-color: #ff9900; }
    .cand-card.suspect-text { border-left-color: #ec4899; }
    .cand-card.missed { border-left-color: #ff3333; }
    
    .card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .card-id { font-family: monospace; font-weight: 700; font-size: 13px; color: #38bdf8; }
    .card-conf { font-size: 11px; font-weight: 700; color: #a5f3fc; }
    .card-label { font-size: 12px; font-weight: 600; color: #f1f5f9; margin-bottom: 4px; }
    .card-notes { font-size: 11px; color: #94a3b8; line-height: 1.4; }
    .card-decision { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #334155; display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
    .decision-badge { background: #334155; color: #cbd5e1; padding: 2px 6px; border-radius: 3px; font-weight: 600; font-family: monospace; }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <span class="badge-yolo">YOLO GEO-2 Baseline</span>
      <h1>Review Paket sheet-1-p1 (3573×2526 px)</h1>
    </div>
    <div class="header-stats">
      <div class="stat-box"><span class="stat-label">Total Deteksi</span><span class="stat-val">87</span></div>
      <div class="stat-box"><span class="stat-label">Matched (Konsisten)</span><span class="stat-val" style="color:#00cc44;">34</span></div>
      <div class="stat-box"><span class="stat-label">Added (Tambahan)</span><span class="stat-val" style="color:#0088ff;">46</span></div>
      <div class="stat-box"><span class="stat-label">Shift Boundary</span><span class="stat-val" style="color:#ff9900;">7</span></div>
      <div class="stat-box"><span class="stat-label">Dugaan FP Teks</span><span class="stat-val" style="color:#ec4899;">5</span></div>
      <div class="stat-box"><span class="stat-label">Missed Baseline</span><span class="stat-val" style="color:#ff3333;">19</span></div>
      <div class="stat-box"><span class="stat-label">Status Review</span><span class="stat-val" style="color:#fbbf24;">UNRESOLVED</span></div>
    </div>
  </header>

  <div class="main-layout">
    <div class="canvas-container" id="viewport">
      <div class="stage" id="stage">
        <img class="base-img" src="sheet-1-p1_original.png" alt="P&ID Canvas">
        <svg class="svg-overlay" id="svgOverlay" viewBox="0 0 3573 2526">
          <!-- Bounding boxes injected via JS -->
        </svg>
      </div>

      <div class="floating-toolbar">
        <button class="btn" id="btnZoomIn">Zoom In (+)</button>
        <button class="btn" id="btnZoomOut">Zoom Out (-)</button>
        <button class="btn" id="btnZoomFit">Fit Screen</button>
        <button class="btn" id="btnZoom100">100%</button>
        <button class="btn btn-primary" id="btnToggleBBox">Toggle BBox</button>
      </div>
    </div>

    <div class="sidebar">
      <div class="sidebar-header">
        <div style="font-size: 13px; font-weight: 600; color: #f8fafc;">Filter Kategori Review:</div>
        <div class="tab-pills">
          <button class="tab-pill active" data-filter="all">Semua (106)</button>
          <button class="tab-pill" data-filter="matched">Matched (34)</button>
          <button class="tab-pill" data-filter="added">Added (46)</button>
          <button class="tab-pill" data-filter="shift">Shift (7)</button>
          <button class="tab-pill" data-filter="suspect">FP Teks (5)</button>
          <button class="tab-pill" data-filter="missed">Missed (19)</button>
        </div>
      </div>

      <div class="cand-list" id="candList">
        <!-- Candidate cards injected via JS -->
      </div>
    </div>
  </div>

  <script>
    const manifest = ${JSON.stringify(manifestPayload)};
    const viewport = document.getElementById('viewport');
    const stage = document.getElementById('stage');
    const svgOverlay = document.getElementById('svgOverlay');
    const candList = document.getElementById('candList');

    let scale = 1.0;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let showBBoxes = true;
    let currentFilter = 'all';

    function fitToScreen() {
      const vW = viewport.clientWidth;
      const vH = viewport.clientHeight;
      const sW = 3573;
      const sH = 2526;
      scale = Math.min(vW / sW, vH / sH) * 0.96;
      panX = (vW - (sW * scale)) / 2;
      panY = (vH - (sH * scale)) / 2;
      applyTransform();
    }

    function applyTransform() {
      stage.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
    }

    viewport.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mX = e.clientX - rect.left;
      const mY = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.85 : 1.15;
      const newScale = Math.max(0.1, Math.min(3.5, scale * factor));
      panX = mX - (mX - panX) * (newScale / scale);
      panY = mY - (mY - panY) * (newScale / scale);
      scale = newScale;
      applyTransform();
    }, { passive: false });

    document.getElementById('btnZoomIn').onclick = () => { scale = Math.min(3.5, scale * 1.25); applyTransform(); };
    document.getElementById('btnZoomOut').onclick = () => { scale = Math.max(0.1, scale * 0.8); applyTransform(); };
    document.getElementById('btnZoomFit').onclick = fitToScreen;
    document.getElementById('btnZoom100').onclick = () => { scale = 1.0; applyTransform(); };
    document.getElementById('btnToggleBBox').onclick = () => {
      showBBoxes = !showBBoxes;
      svgOverlay.style.display = showBBoxes ? 'block' : 'none';
      document.getElementById('btnToggleBBox').textContent = showBBoxes ? 'Hide BBox' : 'Show BBox';
    };

    function focusOnBox(b) {
      const cX = (b.x1 + b.x2) / 2;
      const cY = (b.y1 + b.y2) / 2;
      scale = 1.25;
      panX = (viewport.clientWidth / 2) - (cX * scale);
      panY = (viewport.clientHeight / 2) - (cY * scale);
      applyTransform();
    }

    function renderView() {
      // 1. Draw SVG Overlay
      let svgHtml = '';
      
      // Draw GEO-2 candidates
      manifest.candidates.forEach(c => {
        let stroke = '#0088ff';
        if (c.category === 'matched') stroke = '#00cc44';
        else if (c.category === 'shift') stroke = '#ff9900';
        if (c.isSuspectText) stroke = '#ec4899';

        const w = c.box.x2 - c.box.x1;
        const h = c.box.y2 - c.box.y1;
        svgHtml += \`
          <rect id="svg-box-\${c.id}" x="\${c.box.x1}" y="\${c.box.y1}" width="\${w}" height="\${h}"
                fill="none" stroke="\${stroke}" stroke-width="2.5" opacity="0.85"/>
          <text x="\${c.box.x1}" y="\${Math.max(14, c.box.y1 - 4)}" fill="\${stroke}"
                font-family="monospace" font-size="11" font-weight="bold">\${c.id} \${c.rawLabel.split('.')[1] || c.rawLabel}</text>
        \`;
      });

      // Draw Missed Baseline
      manifest.missedBaseline.forEach(m => {
        const w = m.box.x2 - m.box.x1;
        const h = m.box.y2 - m.box.y1;
        svgHtml += \`
          <rect id="svg-box-\${m.id}" x="\${m.box.x1}" y="\${m.box.y1}" width="\${w}" height="\${h}"
                fill="none" stroke="#ff3333" stroke-width="2" stroke-dasharray="6,4" opacity="0.9"/>
          <text x="\${m.box.x1}" y="\${Math.max(14, m.box.y1 - 4)}" fill="#ff3333"
                font-family="monospace" font-size="10" font-weight="bold">\${m.id}</text>
        \`;
      });

      svgOverlay.innerHTML = svgHtml;

      // 2. Render Cards in Sidebar
      renderCards();
    }

    function renderCards() {
      candList.innerHTML = '';
      let list = [];

      if (currentFilter === 'all') {
        list = [...manifest.candidates, ...manifest.missedBaseline];
      } else if (currentFilter === 'matched') {
        list = manifest.candidates.filter(c => c.category === 'matched');
      } else if (currentFilter === 'added') {
        list = manifest.candidates.filter(c => c.category === 'added');
      } else if (currentFilter === 'shift') {
        list = manifest.candidates.filter(c => c.category === 'shift');
      } else if (currentFilter === 'suspect') {
        list = manifest.candidates.filter(c => c.isSuspectText);
      } else if (currentFilter === 'missed') {
        list = manifest.missedBaseline;
      }

      list.forEach(item => {
        const isMissed = item.category === 'missed_baseline';
        const card = document.createElement('div');
        let cardCls = 'cand-card ' + item.category;
        if (item.isSuspectText) cardCls += ' suspect-text';
        card.className = cardCls;
        card.id = 'card-' + item.id;

        card.innerHTML = \`
          <div class="card-top">
            <span class="card-id">\${item.id}</span>
            <span class="card-conf">\${(item.confidence * 100).toFixed(1)}%</span>
          </div>
          <div class="card-label">\${item.rawLabel}</div>
          <div class="card-notes">\${item.categoryNotes}</div>
          <div class="card-decision">
            <span style="color:#94a3b8;">Keputusan Manusia:</span>
            <span class="decision-badge">\${item.humanDecisionSlot.status}</span>
          </div>
        \`;

        card.onclick = () => {
          document.querySelectorAll('.cand-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          focusOnBox(item.box);
        };

        candList.appendChild(card);
      });
    }

    document.querySelectorAll('.tab-pill').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderCards();
      };
    });

    window.onload = () => {
      fitToScreen();
      renderView();
    };
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(OUT_DIR, 'index.html'), htmlViewer, 'utf8');

console.log('\n[SUCCESS] Paket review YOLO-only berhasil dibuat secara eksklusif:');
console.log(`  1. JSON Manifest: ${path.join(OUT_DIR, 'geo2-yolo-manifest.json')}`);
console.log(`  2. CSV Manifest:  ${path.join(OUT_DIR, 'geo2-yolo-manifest.csv')}`);
console.log(`  3. MD Manifest:   ${path.join(OUT_DIR, 'geo2-yolo-manifest.md')}`);
console.log(`  4. HTML Viewer:   ${path.join(OUT_DIR, 'index.html')}`);
console.log(`  5. Overlay PNG:   ${copiedOverlay}`);
console.log(`  6. Original PNG:  ${copiedOriginal}`);
