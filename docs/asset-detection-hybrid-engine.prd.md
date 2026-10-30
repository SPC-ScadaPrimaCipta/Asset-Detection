# Product Requirements Document (PRD)
## Asset Detection Hybrid Engine

**Status:** Draft  
**Version:** 1.0  
**Feature Flag:** `ASSET_DETECTION_HYBRID_ENABLED`  
**Default Flag State:** `false`  
**Scope:** Existing Asset Detection module only  

---

## 1. Ringkasan

Asset Detection akan diperbarui menggunakan arsitektur hybrid dengan:

- **YOLO ONNX** sebagai engine object detection utama.
- **OpenCV** untuk image preprocessing, ROI processing, dan template matching fallback.
- **OCR** untuk membaca label, tag aset, nomor valve, instrument identifier, atau serial number.
- **Gemini/AI** sebagai engine pendukung yang hanya melakukan verifikasi hasil ambigu dan enrichment terbatas.

Implementasi harus mengikuti prinsip:

- **YAGNI**: tidak menambahkan kemampuan yang belum diperlukan.
- **KISS**: menggunakan alur sederhana dan mudah diaudit.
- **DRY**: menggunakan kembali helper, service, dependency, konfigurasi, logger, dan pola data yang telah tersedia.

Pipeline baru harus berada di belakang feature flag. Pipeline lama wajib tetap berjalan tanpa perubahan ketika feature flag tidak aktif.

---

## 2. Latar Belakang

Asset Detection pada gambar teknis, diagram, atau dokumen visual dapat menghasilkan deteksi yang tidak konsisten karena:

- Simbol aset memiliki ukuran kecil atau resolusi rendah.
- Gambar dapat buram, terpotong, miring, atau memiliki kontras rendah.
- OCR tidak selalu dapat membaca tag atau nomor instrumen secara akurat.
- Object detector dapat memberikan confidence rendah untuk simbol yang mirip.
- Beberapa kelas model YOLO memiliki label duplikat.
- Model memiliki label mentah yang tidak konsisten, tetapi tetap harus dipertahankan agar sesuai dengan output model.
- AI generatif dapat membantu verifikasi, tetapi tidak boleh menjadi engine utama atau dipanggil untuk seluruh request.

Pendekatan hybrid digunakan untuk menggabungkan object detection, OCR, OpenCV, dan AI verification secara terkontrol.

---

## 3. Tujuan

### 3.1 Tujuan Produk

- Meningkatkan kemampuan deteksi aset dari gambar teknis.
- Menggunakan YOLO ONNX sebagai sumber deteksi visual utama.
- Menggunakan OCR untuk mengekstrak informasi tekstual pendukung.
- Menggunakan OpenCV sebagai fallback ketika hasil YOLO tidak usable.
- Menggunakan Gemini hanya untuk verifikasi kasus ambigu.
- Merekam jalur dan hasil proses deteksi agar dapat diaudit.
- Menjaga kompatibilitas dengan pipeline Asset Detection lama.

### 3.2 Tujuan Teknis

- Menjaga class ID YOLO dari index `0` sampai `32`.
- Menjaga label mentah model sesuai `data.yml`.
- Menyediakan satu source of truth untuk class mapping.
- Menambahkan process context pada hasil deteksi.
- Menghindari perubahan kontrak API yang merusak consumer lama.
- Menghindari pembuatan microservice atau sistem baru yang tidak diperlukan.
- Mendukung rollout aman menggunakan feature flag.

---

## 4. Non-Tujuan

Fitur ini tidak mencakup:

- Training, fine-tuning, retraining, atau export ulang model YOLO.
- Pembuatan model computer vision baru.
- Pembuatan microservice baru.
- Pembuatan worker, queue, scheduler, atau database baru.
- Pembuatan sistem template management baru.
- Pembuatan template OpenCV secara otomatis.
- Penggantian total pipeline legacy.
- Penggunaan Gemini sebagai engine object detection utama.
- Pemanggilan Gemini untuk semua gambar atau semua request.
- Backfill data historis.
- Penghapusan pipeline lama.
- Penggabungan class ID YOLO yang memiliki label sama.
- Perbaikan ejaan label mentah model.
- Perubahan class order pada model YOLO.
- Refactor lintas modul yang tidak terkait dengan Asset Detection.

---

## 5. Batasan Implementasi

1. Tidak boleh melakukan training atau fine-tuning YOLO.
2. Tidak boleh membuat microservice baru.
3. Tidak boleh menambah database atau tabel baru.
4. Tidak boleh mengubah index class YOLO.
5. Tidak boleh menghapus class YOLO yang tersedia.
6. Tidak boleh menggabungkan class ID duplikat.
7. Tidak boleh mengubah `modelLabel` dari model.
8. Tidak boleh hardcode label model di luar `yolo-class-map.ts`.
9. Tidak boleh menambahkan dependency baru jika dependency setara sudah tersedia dalam repository.
10. Tidak boleh menggunakan Gemini sebagai fallback global.
11. Tidak boleh menyebarkan confidence threshold atau magic number di banyak file.
12. Tidak boleh mengubah perilaku pipeline legacy saat feature flag OFF.
13. Tidak boleh menyimpan API key, token, raw image binary, stack trace lengkap, atau raw Gemini response pada database.
14. Tidak boleh menulis decoder YOLO sebelum input/output ONNX diverifikasi.

---

## 6. Arsitektur Target

```text
Image Input
    │
    ├── Feature Flag OFF
    │   │
    │   └── Legacy Asset Detection Pipeline
    │
    └── Feature Flag ON
        │
        ├── OpenCV Preprocessing
        │
        ├── YOLO ONNX Inference
        │   │
        │   ├── Valid Candidate
        │   │   │
        │   │   └── OCR on Candidate ROI
        │   │
        │   └── Invalid Candidate / Low Confidence / Error
        │       │
        │       └── OpenCV Template Matching Fallback
        │           │
        │           └── OCR on Template ROI
        │
        ├── Confidence Combination
        │
        ├── Gemini Verification
        │   │
        │   └── Only for Ambiguous or Conflicting Results
        │
        ├── Final Detection Result
        │
        └── Persist process_context
```

---

## 7. Pipeline Deteksi

### 7.1 Feature Flag Evaluation

Sistem harus mengevaluasi feature flag sebelum menjalankan pipeline.

| Kondisi | Perilaku |
|---|---|
| `ASSET_DETECTION_HYBRID_ENABLED=false` | Jalankan pipeline legacy tanpa perubahan perilaku |
| `ASSET_DETECTION_HYBRID_ENABLED=true` | Jalankan pipeline hybrid |

Nilai default feature flag:

```env
ASSET_DETECTION_HYBRID_ENABLED=false
```

### 7.2 OpenCV Preprocessing

OpenCV digunakan sebelum YOLO inference untuk mempersiapkan gambar sesuai kebutuhan model ONNX.

Preprocessing dapat mencakup:

- Resize.
- Letterbox.
- Padding.
- Color conversion BGR ke RGB atau sebaliknya.
- Konversi HWC ke CHW.
- Konversi tipe data.
- Normalisasi piksel.
- Perhitungan scale ratio dan padding offset.

Detail preprocessing tidak boleh diasumsikan dari `data.yml`. Detail tersebut wajib diperoleh dari file ONNX, metadata model, kode exporter, atau implementasi inference lama yang telah tervalidasi.

### 7.3 YOLO ONNX Inference

YOLO ONNX adalah engine object detection utama.

Setiap kandidat YOLO harus memuat:

```ts
interface YoloDetectionCandidate {
  engine: 'yolo';
  classId: number;
  modelLabel: string;
  assetType: AssetType | null;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

Kandidat YOLO dapat diterima jika:

- `classId` tersedia dalam `yolo-class-map.ts`.
- `classId` bukan `0`.
- Class memiliki `enabled: true`.
- Confidence memenuhi `YOLO_CONFIDENCE_THRESHOLD`.
- Bounding box valid.

### 7.4 OCR Enrichment

OCR digunakan pada ROI kandidat YOLO atau ROI template matching.

OCR digunakan untuk mengekstrak:

- Asset tag.
- Valve number.
- Equipment identifier.
- Instrument identifier.
- Serial number.
- Label teks teknis.
- Metadata pendukung lain yang relevan.

OCR tidak boleh mengubah `classId` YOLO secara langsung.

OCR hanya dapat digunakan untuk:

- Menambah metadata hasil deteksi.
- Menambah bukti pendukung.
- Menentukan conflict state.
- Menentukan apakah Gemini verification diperlukan.
- Mendukung hasil dari template matching.

### 7.5 OpenCV Template Matching Fallback

Template matching digunakan sebagai fallback, bukan engine utama.

Template matching dijalankan apabila:

- YOLO gagal dieksekusi.
- YOLO tidak menghasilkan kandidat valid.
- YOLO hanya menghasilkan `classId = 0`.
- Confidence YOLO berada di bawah threshold.
- Kandidat YOLO tidak dapat digunakan setelah validasi.
- Output YOLO tidak dapat diproses karena error postprocessing.

Template matching harus:

- Menggunakan template yang sudah tersedia.
- Tidak membuat template baru secara otomatis.
- Tidak membuat sistem template management baru.
- Mencatat `templateId` dan confidence dalam `process_context`.
- Memenuhi `TEMPLATE_MATCHING_THRESHOLD` sebelum menjadi kandidat valid.

### 7.6 Gemini Verification

Gemini digunakan sebagai verifier dan enrichment engine, bukan engine deteksi utama.

Gemini hanya boleh dipanggil bila salah satu kondisi berikut terjadi:

1. Confidence gabungan berada dalam zona ambiguity.
2. Hasil YOLO dan OCR saling bertentangan.
3. Terdapat lebih dari satu kandidat dengan confidence yang berdekatan.
4. YOLO dan template matching menghasilkan kandidat yang bertentangan.
5. Hasil OCR secara kuat mengindikasikan kandidat yang tidak konsisten dengan hasil visual.

Gemini tidak boleh dipanggil bila:

- YOLO memiliki confidence tinggi dan tidak terdapat konflik.
- Tidak ada kandidat visual yang dapat diverifikasi.
- Gemini verification dimatikan.
- Retry policy tidak mengizinkan retry.
- Request sebelumnya telah gagal dan fallback non-AI sudah cukup.

Gemini hanya boleh memilih dari kandidat yang telah tersedia:

```ts
type GeminiDecision =
  | 'selected_candidate'
  | 'rejected'
  | 'needs_review';
```

Gemini tidak boleh:

- Membuat class baru.
- Menghasilkan label di luar `yolo-class-map.ts`.
- Mengubah class ID tanpa memilih kandidat yang telah disediakan.
- Menjadi satu-satunya dasar hasil final jika tidak ada kandidat visual.

---

## 8. Model YOLO dan Class Mapping

### 8.1 Aturan Class Mapping

Model YOLO memiliki 33 class index, dari `0` sampai `32`.

Aturan:

- `classId` adalah index resmi dari model ONNX.
- `modelLabel` harus identik dengan label pada `data.yml`.
- `assetType` digunakan untuk normalisasi nama internal aplikasi.
- `classId` tidak boleh diubah, diurut ulang, dihapus, atau digabungkan.
- `classId = 0` tidak boleh menjadi hasil final.
- Label duplikat tetap harus dipertahankan.
- Semua mapping harus berada dalam `yolo-class-map.ts`.
- Tidak boleh ada hardcoded label model di file lain.

### 8.2 Class Mapping

| Class ID | Model Label | Asset Type Internal | Enabled |
|---:|---|---|---|
| 0 | `Not_used` | `null` | No |
| 1 | `Gate_Valve` | `gate_valve` | Yes |
| 2 | `Ball_Valve` | `ball_valve` | Yes |
| 3 | `Globe_valve_NO` | `globe_valve_no` | Yes |
| 4 | `Gate_valve_NO` | `gate_valve_no` | Yes |
| 5 | `Globe_valve_NO` | `globe_valve_no` | Yes |
| 6 | `Butterfly_valve` | `butterfly_valve` | Yes |
| 7 | `Plug valve` | `plug_valve` | Yes |
| 8 | `Check_valve` | `check_valve` | Yes |
| 9 | `Diaphragm_valve` | `diaphragm_valve` | Yes |
| 10 | `Needle_valve` | `needle_valve` | Yes |
| 11 | `Half_Filled_Gate_Valve` | `half_filled_gate_valve` | Yes |
| 12 | `Gate_Valve_NC` | `gate_valve_nc` | Yes |
| 13 | `Globle_valve_NC` | `globe_valve_nc` | Yes |
| 14 | `Control_Valve` | `control_valve` | Yes |
| 15 | `Rotary_Valve` | `rotary_valve` | Yes |
| 16 | `Ball_valve_NC` | `ball_valve_nc` | Yes |
| 17 | `Paddle_blind` | `paddle_blind` | Yes |
| 18 | `Spectacle_blind_Closed` | `spectacle_blind_closed` | Yes |
| 19 | `Spectacle_blind_Open` | `spectacle_blind_open` | Yes |
| 20 | `Reducer` | `reducer` | Yes |
| 21 | `Flange_or_Nozzle` | `flange_or_nozzle` | Yes |
| 22 | `Rupture_disk` | `rupture_disk` | Yes |
| 23 | `Pipe_Insulation_or_Tracing` | `pipe_insulation_or_tracing` | Yes |
| 24 | `Flow_Arrow` | `flow_arrow` | Yes |
| 25 | `sight_glass` | `sight_glass` | Yes |
| 26 | `Instrument_Field` | `instrument_field` | Yes |
| 27 | `Instrument_Field` | `instrument_field` | Yes |
| 28 | `Instrument_Panel` | `instrument_panel` | Yes |
| 29 | `Instrument_Aux_Panel` | `instrument_aux_panel` | Yes |
| 30 | `box` | `box` | Yes |
| 31 | `Instrument_Panel` | `instrument_panel` | Yes |
| 32 | `box` | `box` | Yes |

### 8.3 Duplikasi Label

Duplikasi berikut harus dipertahankan:

| Class ID Pertama | Class ID Kedua | Model Label |
|---:|---:|---|
| 3 | 5 | `Globe_valve_NO` |
| 26 | 27 | `Instrument_Field` |
| 28 | 31 | `Instrument_Panel` |
| 30 | 32 | `box` |

Sistem tidak boleh melakukan deduplikasi hanya berdasarkan `modelLabel`.

Contoh hasil yang benar:

```json
{
  "classId": 13,
  "modelLabel": "Globle_valve_NC",
  "assetType": "globe_valve_nc",
  "confidence": 0.91
}
```

---

## 9. Inspeksi ONNX Wajib

Sebelum implementasi YOLO inference, engineer wajib melakukan inspeksi file ONNX.

Informasi yang harus dilaporkan:

1. Lokasi file ONNX dalam repository.
2. Nama input tensor.
3. Shape input tensor.
4. Apakah dimensi input statis atau dinamis.
5. Data type input.
6. Nama semua output tensor.
7. Shape semua output tensor.
8. Data type output.
9. Ukuran input model.
10. Kebutuhan resize atau letterbox.
11. Urutan channel BGR atau RGB.
12. Format tensor HWC, CHW, NHWC, atau NCHW.
13. Tipe input `float32`, `float16`, `uint8`, atau tipe lain.
14. Metode normalisasi.
15. Penggunaan mean dan standard deviation bila tersedia.
16. Format bounding box: `xywh`, `xyxy`, atau format lain.
17. Coordinate space: normalized atau pixel.
18. Lokasi object confidence.
19. Lokasi class confidence.
20. Konfirmasi apakah NMS telah terdapat pada output model.
21. Metode NMS bila belum tersedia pada model.
22. Konfirmasi bahwa jumlah class konsisten dengan 33 class mapping.
23. Daftar class berdasarkan urutan index `0` sampai `32`.

Jika salah satu informasi tidak dapat dipastikan:

- Hentikan implementasi inference YOLO.
- Laporkan informasi yang belum diketahui.
- Jangan menebak input shape, preprocessing, output layout, atau decoder.
- Jangan membuat postprocessing berdasarkan asumsi versi YOLO.

---

## 10. Konfigurasi

Konfigurasi harus mengikuti konvensi repository dan berada pada satu lokasi terpusat.

| Environment Variable | Fungsi |
|---|---|
| `ASSET_DETECTION_HYBRID_ENABLED` | Mengaktifkan pipeline hybrid |
| `YOLO_MODEL_PATH` | Lokasi file model ONNX |
| `YOLO_CONFIDENCE_THRESHOLD` | Minimum confidence YOLO |
| `YOLO_NMS_IOU_THRESHOLD` | IoU threshold untuk NMS |
| `TEMPLATE_MATCHING_THRESHOLD` | Minimum confidence template matching |
| `AMBIGUOUS_CONFIDENCE_LOWER` | Batas bawah zona ambiguity |
| `AMBIGUOUS_CONFIDENCE_UPPER` | Batas atas zona ambiguity |
| `OCR_MIN_CONFIDENCE` | Minimum OCR confidence jika didukung engine OCR |
| `GEMINI_ASSET_VERIFICATION_ENABLED` | Mengaktifkan Gemini verification |
| `GEMINI_TIMEOUT_MS` | Timeout request Gemini |
| `GEMINI_MAX_RETRIES` | Jumlah maksimum retry Gemini jika pola existing mendukung |

Aturan:

- Nilai threshold tidak boleh di-hardcode dalam pipeline.
- Nilai final threshold harus didasarkan pada hasil evaluasi data.
- Tidak boleh menambahkan mekanisme konfigurasi baru bila repository sudah memiliki mekanisme environment/configuration existing.

---

## 11. Confidence Handling

### 11.1 Prinsip

- YOLO adalah sinyal utama.
- OCR adalah bukti tekstual pendukung.
- Template matching adalah fallback visual.
- Gemini digunakan hanya untuk memverifikasi ambiguity.
- Semua confidence dari setiap engine harus tetap disimpan dalam process context.
- Final confidence harus dapat dijelaskan melalui process context.

### 11.2 Zona Confidence

| Zona | Kondisi | Perilaku |
|---|---|---|
| Rendah | `< AMBIGUOUS_CONFIDENCE_LOWER` | Gunakan fallback atau tandai tidak terdeteksi |
| Ambigu | `>= lower` dan `< upper` | Gemini boleh dipanggil jika tersedia kandidat |
| Tinggi | `>= AMBIGUOUS_CONFIDENCE_UPPER` | Gunakan hasil tanpa Gemini jika tidak ada konflik |

Formula penggabungan confidence harus sederhana, eksplisit, dan terkonsentrasi dalam satu helper. Jangan membuat sistem scoring kompleks tanpa kebutuhan yang tervalidasi.

---

## 12. Data Model

### 12.1 Kolom Baru

Tambahkan satu kolom nullable pada record hasil Asset Detection:

```sql
process_context JSONB NULL
```

Jika database/ORM tidak mendukung JSON atau JSONB:

```sql
process_context TEXT NULL
```

### 12.2 Aturan Migration

- Buat tepat satu migration.
- Kolom harus nullable.
- Tidak boleh melakukan backfill.
- Tidak boleh mengubah data lama.
- Tidak boleh membuat tabel baru.
- Tidak boleh menghapus atau mengganti kolom existing.
- Migration harus aman untuk rollback sesuai standar repository.

### 12.3 Struktur Process Context

```ts
type DetectionEngine =
  | 'legacy'
  | 'yolo'
  | 'ocr'
  | 'template_matching'
  | 'gemini';

type DetectionStageStatus =
  | 'success'
  | 'no_detection'
  | 'no_text'
  | 'no_match'
  | 'verified'
  | 'rejected'
  | 'skipped'
  | 'failed';

interface DetectionProcessStage {
  engine: DetectionEngine;
  status: DetectionStageStatus;
  confidence?: number | null;
  classId?: number | null;
  modelLabel?: string | null;
  assetType?: string | null;
  templateId?: string | null;
  reason?: string | null;
  error?: string | null;
}

interface AssetDetectionProcessContext {
  version: 1;
  featureFlag: 'legacy' | 'hybrid_v1';
  status: 'detected' | 'not_detected' | 'partial' | 'failed';
  pipeline: DetectionProcessStage[];
  final: {
    source: 'legacy' | 'yolo' | 'template_matching' | 'gemini' | null;
    confidence: number | null;
    classId: number | null;
    modelLabel: string | null;
    assetType: string | null;
  };
}
```

### 12.4 Contoh Process Context

```json
{
  "version": 1,
  "featureFlag": "hybrid_v1",
  "status": "detected",
  "pipeline": [
    {
      "engine": "yolo",
      "status": "success",
      "confidence": 0.94,
      "classId": 1,
      "modelLabel": "Gate_Valve",
      "assetType": "gate_valve"
    },
    {
      "engine": "ocr",
      "status": "success",
      "confidence": 0.88,
      "reason": "extracted_text: GV-102"
    },
    {
      "engine": "gemini",
      "status": "skipped",
      "reason": "confidence_above_ambiguity_upper_threshold"
    }
  ],
  "final": {
    "source": "yolo",
    "confidence": 0.94,
    "classId": 1,
    "modelLabel": "Gate_Valve",
    "assetType": "gate_valve"
  }
}
```

### 12.5 Larangan Penyimpanan

`process_context` tidak boleh menyimpan:

- API key.
- Access token.
- Secret configuration.
- Raw image file.
- Base64 image.
- Stack trace lengkap.
- Raw response Gemini.
- Payload request lengkap ke Gemini.
- Informasi teknis sensitif yang tidak dibutuhkan untuk audit.

---

## 13. Error Handling

Kegagalan satu engine tidak boleh menggagalkan seluruh proses Asset Detection.

| Kondisi | Perilaku |
|---|---|
| YOLO gagal | Jalankan template matching bila tersedia |
| YOLO tidak menghasilkan kandidat | Jalankan template matching |
| YOLO menghasilkan class `0` | Jangan gunakan sebagai final; lanjut fallback |
| OCR gagal | Pertahankan hasil YOLO/template yang valid |
| Template matching gagal | Pertahankan YOLO valid jika tersedia |
| Gemini gagal | Gunakan hasil non-AI terbaik |
| Semua engine gagal | Simpan `not_detected` atau `failed` beserta process context |

Detail teknis error harus dicatat melalui logger existing.

Database hanya menyimpan error yang ringkas, aman, dan dapat diaudit.

---

## 14. Kebutuhan Pengujian

### 14.1 Test Minimum

| ID | Skenario | Hasil yang Diharapkan |
|---|---|---|
| T-01 | Feature flag OFF | Legacy pipeline dipanggil, hybrid pipeline tidak dipanggil |
| T-02 | Feature flag ON | Hybrid pipeline dijalankan |
| T-03 | YOLO valid confidence tinggi | Hasil YOLO menjadi final |
| T-04 | YOLO valid confidence tinggi tanpa konflik | Gemini tidak dipanggil |
| T-05 | YOLO menghasilkan class `0` | `Not_used` tidak menjadi hasil final |
| T-06 | Class ID duplikat | Class ID asli tetap tersimpan |
| T-07 | YOLO gagal | Template matching dijalankan |
| T-08 | YOLO confidence rendah | Template matching dijalankan sesuai konfigurasi |
| T-09 | OCR gagal | Hasil YOLO valid tetap digunakan |
| T-10 | Template matching valid | Hasil template dapat menjadi final |
| T-11 | Confidence ambigu | Gemini dipanggil jika aktif |
| T-12 | YOLO dan OCR konflik | Gemini dapat dipanggil jika kondisi terpenuhi |
| T-13 | Gemini gagal | Hasil non-AI terbaik tetap digunakan |
| T-14 | Semua engine gagal | Status `not_detected` atau `failed` tersimpan |
| T-15 | Migration | Data lama tetap valid dengan `process_context = null` |
| T-16 | Process context | Setiap eksekusi hybrid menyimpan jalur engine dan final result |

### 14.2 Test Class Mapping

Test mapping wajib mencakup:

- `classId = 0` memiliki `enabled: false`.
- `classId = 0` memiliki `assetType: null`.
- `classId = 3` dan `classId = 5` tetap berbeda.
- `classId = 26` dan `classId = 27` tetap berbeda.
- `classId = 28` dan `classId = 31` tetap berbeda.
- `classId = 30` dan `classId = 32` tetap berbeda.
- `classId = 13` mempertahankan `modelLabel: "Globle_valve_NC"`.
- Tidak terdapat label model hardcoded di luar `yolo-class-map.ts`.

---

## 15. Kriteria Penerimaan

| ID | Kriteria |
|---|---|
| AC-01 | Feature flag default bernilai OFF |
| AC-02 | Feature flag OFF mempertahankan perilaku pipeline legacy |
| AC-03 | Feature flag ON menjalankan pipeline hybrid |
| AC-04 | YOLO ONNX menjadi engine visual utama |
| AC-05 | OpenCV digunakan untuk preprocessing |
| AC-06 | OCR digunakan sebagai enrichment pada ROI kandidat |
| AC-07 | Template matching hanya digunakan sebagai fallback |
| AC-08 | Gemini hanya digunakan pada hasil ambigu atau konflik |
| AC-09 | Gemini tidak dipanggil untuk YOLO confidence tinggi tanpa konflik |
| AC-10 | Model class mapping terdiri dari index 0 sampai 32 |
| AC-11 | `Not_used` tidak dapat menjadi hasil final |
| AC-12 | Duplikasi class label tidak digabungkan |
| AC-13 | Label mentah model tidak diubah |
| AC-14 | Semua mapping class berasal dari `yolo-class-map.ts` |
| AC-15 | Setiap hasil hybrid memiliki `process_context` |
| AC-16 | `process_context` menyimpan source dan confidence final |
| AC-17 | Migration `process_context` nullable dan aman untuk data lama |
| AC-18 | Kegagalan satu engine tidak menggagalkan seluruh request |
| AC-19 | Tidak ada microservice baru |
| AC-20 | Tidak ada training atau fine-tuning YOLO |
| AC-21 | Tidak ada perubahan file di luar scope yang disetujui |
| AC-22 | Input/output ONNX diverifikasi sebelum decoder YOLO dibuat |

---

## 16. Definition of Done

Implementasi dianggap selesai jika seluruh kondisi berikut terpenuhi:

- Pipeline hybrid tersedia melalui feature flag.
- Feature flag default OFF.
- Pipeline legacy tidak berubah ketika feature flag OFF.
- File `yolo-class-map.ts` tersedia sebagai source of truth.
- Mapping 33 class sudah sesuai `data.yml`.
- Class ID, model label, asset type, confidence, dan bounding box tersimpan untuk hasil YOLO.
- `Not_used` tidak dapat menjadi hasil final.
- Class duplikat mempertahankan index aslinya.
- YOLO, OCR, template matching, dan Gemini mengikuti urutan pipeline yang ditetapkan.
- Gemini hanya dipanggil pada kondisi ambiguity atau conflict.
- Satu migration nullable untuk `process_context` tersedia.
- Semua test minimum tersedia dan lulus.
- Tidak ada training model.
- Tidak ada