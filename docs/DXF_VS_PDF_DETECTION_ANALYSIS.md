# Analisis Perbedaan Deteksi DXF vs PDF

## Problem Statement

**PDF Detection:** Dapat mendeteksi "HOA P-0201" dengan akurat  
**DXF Detection:** Salah membaca menjadi "PSH P-0201" atau "PI P-xxxx"

## Root Cause Analysis

### 1. Pipeline yang Berbeda Fundamental

```text
┌─────────────────────────────────────────────────────┐
│              PDF DETECTION PIPELINE                  │
├─────────────────────────────────────────────────────┤
│ 1. Render PDF → High-res PNG (MuPDF)                │
│ 2. Kirim PNG ke Gemini Vision API                   │
│ 3. AI "melihat" gambar secara visual                │
│ 4. AI membaca SEMUA teks dalam konteks visual       │
│ 5. AI memahami posisi spatial simbol & label        │
│ 6. Output: assetTag dengan akurasi OCR-like         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              DXF DETECTION PIPELINE                  │
├─────────────────────────────────────────────────────┤
│ 1. Parse DXF file → Extract entities                │
│ 2. Baca TEXT entities langsung dari DXF structure   │
│ 3. TIDAK ADA VISUAL RENDERING ke AI                 │
│ 4. TEXT content = raw string dari DXF data          │
│ 5. Spatial association via coordinate matching      │
│ 6. Output: assetTag dari TEXT entity raw content    │
└─────────────────────────────────────────────────────┘
```

### 2. Penyebab Spesifik Error

**Issue:** DXF pipeline membaca TEXT entity content **PERSIS seperti yang tersimpan dalam file DXF**, bukan seperti yang **terlihat di layar AutoCAD**.

#### Kasus "HOA P-0201" menjadi "PSH P-0201"

Kemungkinan penyebab:

1. **Multi-layer Text Overlap**
   ```text
   Layer "EQUIPMENT_TAG":  "PSH"  (di atas)
   Layer "EQUIPMENT_TAG2": "HOA"  (di bawah, tidak terlihat)
   ↓
   DXF parser membaca TEXT di layer "EQUIPMENT_TAG" dulu
   Result: "PSH P-0201" ❌
   ```

2. **MTEXT dengan Formatting Code**
   ```text
   DXF raw content: "{\H0.7x;P}{\H1.0x;SH} P-0201"
   Display: PSH P-0201
   Seharusnya: HOA P-0201
   ```
   MTEXT codes (`{\H...}`, `\P`, `\~`) bisa menyebabkan teks tampil berbeda dari raw content.

3. **ATTDEF (Attribute Definition) vs MTEXT**
   - AutoCAD blocks sering punya ATTDEF untuk tag
   - Content ATTDEF bisa berbeda dari visual display
   - DXF parser mengambil `defaultValue` dari ATTDEF, bukan rendered value

4. **Text dengan Override atau Xref**
   - XREF (external reference) bisa override text content
   - DXF parser tidak resolve XREF secara penuh

### 3. Bukti dari Source Code

**DXF Text Extraction** (`lib/dxf-parser.ts:364`):
```typescript
const rawText = String(e.text ?? e.string ?? '').trim();
const cleanText = stripMtext(rawText);
if (cleanText) {
  entities.push({
    kind: type as 'TEXT' | 'MTEXT',
    text: cleanText,  // ← raw string dari DXF, bukan visual rendering
    position: pos,
    layer,
    height: Number(e.textHeight ?? e.height ?? 0),
  });
}
```

`stripMtext()` hanya menghapus formatting codes sederhana, **TIDAK** me-render teks seperti AutoCAD.

**PDF Detection** (`lib/ai-agent.ts`):
```typescript
// Gemini Vision melihat RENDERED IMAGE, bukan raw data
const pageImageBase64 = /* PNG dari MuPDF rendering */;
const response = await callGemini({
  image: pageImageBase64,  // ← AI "sees" the drawing visually
  prompt: "Extract asset tags and equipment types from P&ID..."
});
```

## Solusi yang Diperlukan

### Option 1: Render DXF → PNG → AI Vision (Recommended)

**Implementasi:**
```typescript
// lib/dxf-detection.ts
export async function runDxfDetection(
  documentId: string,
  legendSymbols: LegendSymbolRef[],
  options: { useVisionFallback: boolean }
): Promise<DxfDetection[]> {
  
  const dxfData = await parseDxf(filePath);
  
  // NEW: Render DXF to high-res PNG
  const pngBuffer = await renderDxfToPng(filePath, {
    width: 4000,
    height: 3000,
    dpi: 300
  });
  
  // Run AI Vision detection (sama seperti PDF)
  const visionDetections = await runDetectionAgent({
    page: 1,
    pageImageBase64: pngBuffer.toString('base64'),
    legendId: legendSymbols[0].id,
    // ...
  });
  
  // Merge dengan DXF vector data untuk geometry precision
  return mergeDxfVectorWithVision(dxfData, visionDetections);
}
```

**Keuntungan:**
- ✅ Akurasi OCR sama dengan PDF
- ✅ AI "melihat" gambar seperti manusia
- ✅ Tidak terpengaruh layer order atau MTEXT codes
- ✅ Consistent dengan PDF pipeline

**Kerugian:**
- ⚠️ Butuh rendering engine (MuPDF tidak support DXF native)
- ⚠️ Alternatif: AutoCAD ODA File Converter atau DWG TrueView CLI

### Option 2: AI Text-Prompt Fallback untuk Ambiguous Cases

**Implementasi:**
```typescript
// Saat confidence rendah atau tag pattern mismatch
if (confidence < 0.5 || !matchesLegendPattern(extractedTag)) {
  // Crop region sekitar symbol
  const regionPng = await cropDxfRegion(dxfData, bbox);
  
  // Ask Gemini what the tag actually is
  const aiTag = await askGeminiTextOnly({
    prompt: `What is the equipment tag visible in this symbol? 
             Expected format: [TYPE] [TAG]
             Example: HOA P-0201, PSH P-0301
             Only return the tag, nothing else.`,
    image: regionPng
  });
  
  // Override DXF text extraction with AI answer
  if (aiTag && isValidTagFormat(aiTag)) {
    detection.assetTag = aiTag;
    detection.confidence = 0.85;
    detection.evidence.push('AI visual confirmation corrected DXF text');
  }
}
```

**Keuntungan:**
- ✅ Tidak perlu full render DXF
- ✅ Only runs untuk ambiguous cases (hemat API cost)
- ✅ Kombinasi presisi vector DXF + akurasi visual AI

### Option 3: Improve DXF Text Layer Priority Logic

**Current logic** (`lib/dxf-detection.ts:1135`):
```typescript
// Ambil TEXT dari semua layer, prioritas tidak jelas
for (const tt of tagTexts) {
  const prio = tagLayerPriority(tt.layer, lookup);
  // Problem: jika "PSH" dan "HOA" di layer berbeda,
  // yang mana yang benar?
}
```

**Improved logic:**
```typescript
// HARUS pilih layer yang visibility=ON dan freeze=OFF di DXF
function getVisibleTextOnly(texts: DxfTextEntity[], dxf: DxfParseResult): DxfTextEntity[] {
  const visibleLayers = new Set<string>();
  
  // Read LAYER table untuk cek visibility flags
  for (const layer of dxf.tables.layer) {
    // Bit 1: layer frozen
    // Bit 2: layer locked (but still visible)
    const isFrozen = (layer.flags & 1) !== 0;
    const isOff = layer.colorNumber < 0; // negative = OFF
    
    if (!isFrozen && !isOff) {
      visibleLayers.add(layer.name);
    }
  }
  
  return texts.filter(t => visibleLayers.has(t.layer));
}
```

**Keuntungan:**
- ✅ Respect layer visibility AutoCAD
- ✅ Tidak perlu AI rendering

**Kerugian:**
- ⚠️ Masih tidak solve MTEXT formatting codes
- ⚠️ Tidak solve ATTDEF vs visual display mismatch

## Rekomendasi

### Immediate Fix (1-2 hari implementasi)

**Hybrid Approach: DXF Vector + Vision Fallback**

```typescript
// workers/detection-worker.ts
if (document.file_type === 'dxf') {
  // Run vector-based detection first
  const dxfDetections = await runDxfDetection(document.id, legendSymbols, {
    useVisionFallback: false
  });
  
  // Identify low-confidence or pattern-mismatch detections
  const needsVisionConfirm = dxfDetections.filter(d => 
    d.confidence < 0.70 || 
    !matchesAnyLegendPattern(d.assetTag, legendSymbols)
  );
  
  // Render only problematic regions to PNG
  for (const det of needsVisionConfirm) {
    const regionPng = await renderDxfRegion(dxfPath, det.bbox);
    const aiCorrection = await runVisionTagExtraction(regionPng);
    
    if (aiCorrection && aiCorrection.confidence > det.confidence) {
      det.assetTag = aiCorrection.tag;
      det.assetType = aiCorrection.type;
      det.confidence = aiCorrection.confidence;
      det.source = 'VISION';
      det.evidence.push('Visual AI corrected DXF text parsing');
    }
  }
  
  await persistDetections(document.id, job.id, dxfDetections);
}
```

### Long-term Solution (1 minggu)

**Full DXF → PNG Rendering Pipeline**

1. Integrate AutoCAD ODA File Converter atau LibreDWG
2. Convert DXF → High-res PNG server-side
3. Gunakan **SAME** pipeline dengan PDF (Gemini Vision)
4. Fallback ke DXF vector parsing hanya untuk geometry precision

## Testing Plan

### 1. Validation Dataset
- Ambil 10 DXF file yang known issues
- Manual label ground truth: "HOA P-0201", bukan "PSH P-0201"
- Compare:
  - Current DXF pipeline accuracy
  - Vision fallback accuracy
  - Full render pipeline accuracy

### 2. Metrics
```typescript
interface AccuracyMetrics {
  exactMatchRate: number;      // tag 100% benar
  partialMatchRate: number;    // prefix benar (P-0201 benar, tipe salah)
  falsePositiveRate: number;   // deteksi tag yang tidak ada
  falseNegativeRate: number;   // miss tag yang seharusnya ada
}
```

### 3. Benchmark Command
```bash
npm run test -- dxf-vision-accuracy.test.ts
```

## Conclusion

**Root cause:** DXF pipeline membaca raw TEXT entity content, bukan visual rendering seperti yang dilihat di AutoCAD. PDF pipeline menggunakan rendered image ke Gemini Vision, sehingga akurat.

**Best fix:** Implement vision fallback untuk ambiguous DXF text cases. Long-term: full DXF rendering pipeline sama seperti PDF.
