# Design: YOLO + Deterministic CV + Legend Semantic Matching + OCR + AI Fallback

Date: 2026-09-28
Status: Approved
Scope: Asset-Detection accuracy — posisi simbol/tag + missed detections

## 1. Latar
- Keluhan utama: posisi bbox simbol/tag tidak akurat + sering tidak terdeteksi sama sekali.
- Sukses = tag terbaca benar dan menempel ke simbol yang tepat.
- Budget: akurat-maksimal (boleh tambah render cost + Gemini calls).
- Training YOLO di Google Colab, model dihasilkan di sana.
- Dua referensi: PID-Digitizer (prompt ketat, OCR, review) dan p-id-symbols (dataset YOLO valve/instrumen, tanpa OCR).

## 2. Keputusan arsitektur (disetujui)
Nama final: **YOLO + Deterministic CV + Legend Semantic Matching + OCR + AI Fallback**

| Komponen | Tanggung jawab |
|---|---|
| YOLO | Menemukan simbol (kandidat bbox + kelas kasar) |
| OpenCV deterministik | Refinement + geometry + visual evidence |
| OCR | Membaca Asset Tag (bbox tag terpisah) |
| Legend | Menentukan Asset Type (source of truth) |
| Matcher | Menghubungkan simbol P&ID ↔ tag ↔ Legend |
| Gemini | Menangani ambiguity / LOW confidence saja |
| Human Review | Keputusan akhir |

Alur per tile: render PNG → YOLO + CV paralel → `tileToPage` → dedup/merge → asosiasi
tag↔simbol (margin check, ambigu → NEEDS_REVIEW) → Legend semantic match →
confidence fusion → Gemini gap-fill → review → Asset Register/Excel.

Aturan keras: YOLO tidak boleh memutuskan tag/tipe final; tanpa fabrikasi tag
(`null + NEEDS_REVIEW`, bukan `EQUIP-XXXX`); setiap deteksi wajib
`confidence + evidence + validation_status`; REJECTED tidak masuk Excel Sheet 1.

## 3. Komponen (disetujui)
- Colab: bersihkan kelas (duplikat `Instrument_Field/Panel/box`, typo `Globle`),
  peta 33 kelas → `asset_type` (Valve/Control Valve/Instrument/Safety/pendukung),
  export ONNX + `best.pt` kecil. Dataset eksternal hanya lokal (gitignored),
  catat lisensi di `docs/YOLO_PID_SYMBOLS_LICENSE.md`.
- `services/cv`: `yolo_detector.py` + `POST /yolo/detect`
  (lazy-load, env `YOLO_MODEL_PATH/CONF/IOU`, flag `YOLO_ENABLED`, error terstruktur).
- TS: `cvYoloDetect()`, skema Zod kandidat, fusion di `deterministic-page.ts`
  (merge IoU>0.5, bbox YOLO + evidence `yolo:{class} {conf}`), bobot `w_yolo`,
  `stageCounts.yolo*`.
- OCR: multi-varian PSM + deskew + upscale tag kecil + `tagBBox` terpisah,
  normalisasi pola Legend + koreksi `O↔0/I↔1` + provenance (pelajaran PID-Digitizer).

## 4. Data flow, error handling, testing (disetujui)
- Fallback berlapis: YOLO down → CV lama; OCR/Gemini gagal → tandai warning,
  page tidak FAILED; koordinat kanonik page-pixel, `0-1000` hanya di UI.
- Testing: harness Precision/Recall/IoU@0.5/Tag+Association accuracy pada
  5–10 halaman internal + subset val eksternal; unit `yolo-fusion`,
  `spatial-margin`, `tag-normalize`; A/B `YOLO on/off`.

## 5. Yang eksplisit TIDAK diport
- Fabrikasi tag, auto-connect proximity, single-image sync Streamlit/SQLite langsung.
