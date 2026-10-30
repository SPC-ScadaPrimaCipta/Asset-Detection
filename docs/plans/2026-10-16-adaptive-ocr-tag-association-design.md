# Technical Design Document
# Peningkatan Akurasi Deteksi: Adaptive Tag OCR & Fallback Template Matching

**Tanggal:** 2026-10-16  
**Status:** Approved  
**Modul:** Detection (`lib/detection/hybrid-pipeline.ts`, `lib/ocr-engine.ts`, `lib/cv-client.ts`)  

---

## 1. Konteks & Masalah

Pada pipeline deteksi hybrid V3 (YOLO GEO-2 + OCR + Gemini Verifier):
1. **Radius Crop OCR Terlalu Sempit**:
   - `cropBBoxFromBuffer(pngBuffer, symbolBboxPx, 15)` di `lib/detection/hybrid-pipeline.ts` hanya mengambil margin 15 piksel di sekitar kotak deteksi YOLO.
   - Pada P&ID industri, label tag peralatan (misal `P-101A`, `V-102`, `XV-001`) sering berada di atas, di bawah, atau di samping simbol dengan jarak 30–120 piksel.
   - Akibatnya, OCR gagal membaca teks tag atau membaca teks terpotong, sehingga confidence jatuh ke `NEEDS_REVIEW`.
2. **Template Matching Fallback Belum Terhubung**:
   - `services/cv/template_match.py` dan flag `TEMPLATE_MATCH_ENABLED` sudah ada di codebase, namun orchestrator di `hybrid-pipeline.ts` belum menghubungkan pemanggilan fallback template matching ketika YOLO tidak menemukan kandidat atau memiliki confidence sangat rendah.

---

## 2. Arsitektur Target

```
[ Input: Halaman P&ID (PNG & Dimensi) ]
                   │
                   ▼
       [ 1. YOLO GEO-2 Detection ]
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
(Kandidat Terdeteksi)   (Kandidat Kosong / Semua Low Conf)
         │                   │
         │                   ▼ [Fallback: Template Matcher]
         │                   (Cek Legend Symbol Reference Template)
         │                   │
         └─────────┬─────────┘
                   ▼
      [ 2. Dual-Crop & Adaptive Tag OCR ]
       ├── Crop Simbol (8-15px) → imageHash / cache
       └── Crop Konteks Tag (Adaptive: 60-120px) → OCR Tesseract / CV Service
                   │
                   ▼
      [ 3. Tag Tokenization & Spatial Scoring ]
       • Ekstraksi pola tag (PREFIX-NUMBERS-SUFFIX)
       • Penilaian kedekatan spasial (Euclidean / Manhattan)
                   │
                   ▼
      [ 4. Rule Validator & Negative Learning ]
                   │
                   ▼
      [ 5. Gemini Verifier (Kasus Ambigu / Low Conf Saja) ]
                   │
                   ▼
      [ 6. Gemini Fallback & Confidence Fusion ]
                   │
                   ▼
      [ Output: PersistableDetection[] ]
```

---

## 3. Komponen Spesifik & Perubahan Kode

### 3.1. `lib/ocr-engine.ts`
- Tambahkan helper `cropAdaptiveTagRegionFromBuffer()`:
  - Menerima `bbox`, dimensi halaman, dan opsi arah/ekspansi (`expandX`, `expandY`).
  - Menghitung batas crop kontekstual dengan clamping terhadap dimensi halaman.
- Ekstraksi tag yang lebih tahan terhadap teks multi-baris (misal tag di baris 1, nomor layanan di baris 2).

### 3.2. `lib/detection/hybrid-pipeline.ts`
- Modifikasi fungsi `runYoloWithOcr`:
  - Gunakan `cropBufferSymbol` untuk hash visual.
  - Gunakan `cropBufferTag` dengan radius kontekstual adaptif untuk OCR.
  - Integrasikan parser token tag `extractTagTokens` dan `isLikelyTag` dari `lib/ocr-candidate.ts`.
- Tambahkan tahap Fallback Template Matching:
  - Jika hasil deteksi YOLO kosong dan `env.TEMPLATE_MATCH_ENABLED === 'true'`, panggil template matching untuk membandingkan crop kandidat dengan template simbol legenda.

### 3.3. `lib/cv-client.ts`
- Pastikan client HTTP `cvTemplateMatch` terdefinisi dan menangani timeout/error secara graceful jika CV service sedang tidak aktif.

---

## 4. Rencana Verifikasi & Testing

1. **Unit Test**:
   - `__tests__/adaptive-ocr-crop.test.ts`: Uji fungsi crop adaptif dan parsing teks yang terpisah jarak dari simbol.
2. **Integration Test**:
   - `__tests__/hybrid-template-fallback.test.ts`: Uji alur ketika YOLO 0 deteksi, template matching terpanggil dengan aman.
3. **Regression Test**:
   - Jalankan `npm test -- --testPathPattern="yolo|hybrid|ocr"` untuk memastikan tidak ada fungsionalitas lama yang terganggu.
