# Laporan Cakupan Inspeksi Visual — v203 (Tidak Ditingkatkan Produksi)

**Tanggal:** 2026-10-09  
**Status:** *Laporan hanya informatif — tidak mengubah file terlarang, metrik, atau pipeline produksi.*

---

## 1. Cakupan Inspeksi yang Dikonfirmasi ( Dari Manifest v203 )

| No | pageId | SHA256 Gambar | Dimensi (px) | Retained Predictions | Raw Candidates |
|----|--------|---------------|--------------|----------------------|----------------|
| 1 | sheet-1-p1 | `e691c8a1…` | 3573 × 2526 | 60 | 77 |
| 2 | sheet-2-p1 | `fdfabe26…` | 3573 × 2526 | — | — |
| 3 | sheet-3-p1 | `04b1f818…` | 3573 × 2526 | — | — |
| 4 | sheet-4-p1 | `2e18e77e…` | 3573 × 2526 | — | — |
| 5 | sheet-5-p1 | `02dcb729…` | 3573 × 2526 | — | — |
| 6 | sheet-7-p1 | `dcb6475f…` | 3573 × 2526 | — | — |
| 7 | sheet-7-model-p1 | `b999a93c…` | 3573 × 2526 | — | — |
| 8 | sheet-7-rev-p1 | `dcb6475f…` | 3573 × 2526 | — | — |
| 9 | sheet-11-p1 | `63c994a3…` | 3573 × 2526 | — | — |
| 10 | sheet-12-p1 | `a0aff7b1…` | 3573 × 2526 | 6 | 8 |
| 11 | fire-water-p1 | `f655a79b…` | **2526 × 3572** (portrait) | 9 | 11 |
| 12 | fire-water-p2 | `be2d39d0…` | — | — | — |

**Catatan:** `retainedPredictionCount` hanya mencantumkan kandidat YOLO yang masih aktif setelah filter/merge. *RawCandidateCount* adalah kandidat mentah sebelum pemrosesan.

---

## 2. Lokasi & Format Bukti yang Tersedia

### A. Candidate Crops (sudah ada)
Ada 232 file crop di `storage/annotation-inspection-crops/`, masing-masing berisi detail objek yang diprediksi YOLO v203. Contoh nama file:
- `storage/annotation-inspection-crops/sheet-1-p1/crop_00_Instrument_Aux_Panel_conf_0.94.png`
- `storage/annotation-inspection-crops/sheet-12-p1/crop_00_Instrument_Aux_Panel_conf_0.88.png`

### B. Manifest dan Metadata
Setiap halaman memiliki entri di `fixtures/diagnostics/review-v203-baseline-v1/manifest.json` dengan:
- `imageSha256` — hash gambar referensi (full resolution)
- `dimensions` — lebar × tinggi piksel
- `crops` — koordinat bbox per prediksi (`x1, y1, x2, y2` dalam skala pixel)
- `fullPageOverlay` — lapisan overlay penuh untuk review visual
- `tileSeamDiagnostic` — deteksi jarak tikam tile

### C. Candidate Audit Log
`fixtures/ground-truth/candidate-audit-v1.json` berisi 81 audit decisions (lampiran hasil inspeksi awal, 2026-10-05). **LARANGAN: jangan dimodifikasi.**

### D. Ground Truth Draft
`fixtures/ground-truth/dataset-v203.draft.json` masih berstatus `unannotated` untuk semua 12 halaman. **LARANGAN: jangan overwrite dataset legacy `dataset-v1.json`.**

---

## 3. Annotation Sudah Ada vs Masih Diperlukan

| Status | keterangan |
|--------|------------|
| **Candidate crops** | Sudah tersedia untuk sebagian halaman (melintasi sheet-1, sheet-2, sheet-4, sheet-5, sheet-7, sheet-7-model, sheet-7-rev, sheet-11, sheet-12, fire-water-p1). |
| **Full-page overlay** | Sudah digenerate di `fixtures/diagnostics/review-v203-baseline-v1/` (12 file `.png`). |
| **Audit findings (preliminary)** | Sudah ada di `fixtures/ground-truth/audit-findings-preliminary.md` (18/81 kandidat audited, 0% precision). |
| **Dataset draft** | `dataset-v203.draft.json` masih *unannotated* — 0 bbox terdaftar di 12 halaman. |
| **Dataset legacy** | `dataset-v1.json` masih *empty annotations* untuk semua halaman. |
| **Observasi inspeksi pengguna** | Dilaporkan "banyak objek terlewat" oleh pengguna, **belum diverifikasi sebagai bounding box dengan koordinat eksplisit dan kelas**. |

**LARANGAN UTAMA:**
- Jangan menyamakan *"inspection completed"* dengan *"objects enumerated"* maupun *"bbox annotation completed"*.
- Setiap status harus diverifikasi secara independen sebelum di-_ingest_ ke dataset.

---

## 4. Daftar File v203 yang Diusulkan untuk Ingestion

Hanya file **versioned** yang bisa diajukan; jangan overwrite dataset legacy:

1. **`fixtures/diagnostics/review-v203-baseline-v1/manifest.json`** — sudah final, tidak diubah.
2. **`fixtures/diagnostics/predictions-v203-baseline.json`** — baseline prediksi asli, sudah final.
3. **`storage/annotation-inspection-crops/`** — 232 file crop untuk visual review manusia. Bisa diverifikasi kelas/bbox, **tapi bukan pengganti anotasi dataset**.
4. **`fixtures/ground-truth/candidate-audit-v1.json`** — sudah ada, **jangan dimodifikasi** sesuai larangan.
5. **`fixtures/ground-truth/audit-findings-preliminary.md`** — catatan temuan FP systematic, sudah final.

**BUKAN untuk ingestion ke dataset:**
- `fixtures/ground-truth/dataset-v1.json` — *legacy*, tidak boleh overwrite.
- `fixtures/ground-truth/dataset-v203.draft.json` — status *unannotated*, hanya bisa *extend* dengan penandatanganan manual, bukan otomasi.
- Manapun koordinat kelas yang "dianggar" tanpa bukti koordinat eksplisit dari crops/overlay.

---

## 5. Langkah Selanjutnya (Secara Non-Produksi)

1. **Konfirmasi visual review** dari 12 halaman menggunakan overlay + crops yang sudah ada.
2. **Identifikasi manual** objek manakah yang terlewat model (False Negatives), dengan catatan:
   - `pageId`
   - `image SHA` sesuai manifest
   - `bbox koordinat eksplisit` (x1, y1, x2, y2 dari crop/overlay)
   - `raw class decision: confirmed / unresolved`
   - `reviewer provenance` (nama/date inspektor)
3. **Jika annotation tersedia** (berupa file JSON manual dari reviewer), usulkan *ingestion* hanya ke artefak v203 versioned (misal: sub-folder `fixtures/ground-truth/annotation-manual-v203/`), **jangan overwrite** `dataset-v1.json` maupun `dataset-v203.draft.json`.
4. **Jika belum tersedia**, siapkan proses pencatatan baru dari bukti users (screenshot/printscreen overlay + crop), dengan format minimal:
   ```
   annotationId, pageId, image SHA, bbox (x1,y1,x2,y2), rawClassId/rawLabel, reviewer provenance, evidence reference
   ```
5. **Tulis laporan singkat** dengan output:
   - Cakupan inspeksi yang terkonfirmasi
   - Lokasi/format bukti yang benar-benar tersedia
   - Annotation yang sudah ada vs yang masih diperlukan
   - Daftar file v203 yang diusulkan untuk ingestion

---

## 6. Larangan yang Dicatat Ulang

- [x] Jangan mengubah `candidate-audit-v1.json`
- [x] Jangan mengubah `dataset-v1.json`
- [x] Jangan mengubah `reference/baseline v203`
- [x] Jangan mengubah runtime, threshold, tiling, NMS, atau merge
- [x] Jangan memproduksi integrasi produksi/API/worker/UI
- [x] Jangan memakai 28 canonical classes sebagai pengganti 203 raw classes tanpa mapping evaluasi yang disetujui.
- [x] Jangan menyamakan: inspection completed, objects enumerated, bbox annotation completed, class review completed, dataset validated.
- [x] Jangan mengarang koordinat atau kelas tanpa bukti.

---

**Catatan Akhir:** Laporan ini dibuat untuk membatasi scope dan menghindari modifikasi forbidden files/sebelum consensus diterima. Semua langkah selanjutnya memerlukan persetujuan tim (Arga/Dian/Bima/Eka/Citra) sebelum memulai proses *ingestion* atau *evaluasi quality gate*.