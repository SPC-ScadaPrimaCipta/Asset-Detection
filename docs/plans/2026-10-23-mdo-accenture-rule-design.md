# LAPORAN SPESIFIKASI DAN ARSITEKTUR FITUR MDO & WORKFLOW BARU
## Standar Description Rule PT Accenture Indonesia & Redesain Alur UX

**Tanggal:** 23 Oktober 2026  
**Status:** Disetujui & Siap Diimplementasikan  
**Ruang Lingkup:**
1. Transformasi alur halaman: Halaman **Detection** difokuskan murni untuk pendeteksian aset & visual viewer.
2. Halaman **Review** dihapus total dan digantikan oleh **Halaman MDO** (`/mdo`) sebagai gerbang finalisasi (*final step*) sebelum Ekspor Asset Register.
3. Fitur analisis alur proses AI Vision multi-provider untuk membaca diagram P&ID (*From, To, Of, Size, Direction*).
4. Full Customization di halaman MDO: Pengguna dapat mengedit/mengubah seluruh 8 kolom atribut MDO secara leluasa, dengan auto-recalculate Description yang reaktif.

---

## 1. Alur Pengguna Baru (End-to-End User Journey)

```mermaid
flowchart TD
    subgraph Step 1: Document & Legend
        A["Upload P&ID / PFD (PDF/DXF)"] --> B["Pilih Legend Referensi"]
    end

    subgraph Step 2: Detection Workspace (/detection)
        B --> C["Run Detection (AI Vision / YOLO / DXF)"]
        C --> D["P&ID Viewer Interaktif:<br/>Visual Bounding Boxes, Filter, Verifikasi Aset"]
        D --> E["Tombol: Proceed to MDO & Process Flow ➔"]
    end

    subgraph Step 3: MDO & Final Review Workspace (/mdo)
        E --> F["Halaman MDO (Menggantikan /review)"]
        F --> G["Vision AI: Baca P&ID & Telusuri Alur Pipa<br/>(From, To, Of, Size, Direction)"]
        G --> H["Formula Generator (Accenture Rule):<br/>[Prefix-] + Eqp + Size + [OF] + [FROM] + [TO]"]
        H --> I["Full Customization Data Table:<br/>Edit From, To, Of, Size, Tag, Description secara leluasa"]
        I --> J["Approve / Review Aset"]
        J --> K["Final Output: Export Asset Register / MDO (Excel)"]
    end
```

---

## 2. Redesain Halaman Detection (`/detection`)

Halaman detection didesain ulang agar **bersih, fokus, dan tidak bertumpuk**:
- **Tujuan Tunggal:** Deteksi fisik peralatan pada P&ID dan verifikasi visual kotak pembatas (*bounding box*).
- **Elemen Antarmuka:**
  - Selector Dokumen & Selector Legend di header.
  - Tombol **"Run Detection"** dengan indikator progress.
  - Interactive Canvas / P&ID Viewer (Zoom, Pan, Bounding Box highlight, label tag).
  - Tabel Ringkas Deteksi Aset (No, Tag, Type, Confidence, BBox).
  - **Tombol Navigasi Utama:**
    ```tsx
    <Link href={`/mdo?document_id=${selectedDocumentId}`}>
      <Button variant="primary">
        Proceed to MDO & Process Flow ➔
      </Button>
    </Link>
    ```
- **Pembersihan:** Semua tombol Build MDO, drawer MDO, dan kontrol yang tidak relevan dengan deteksi fisik diangkat dari halaman ini dan dipindahkan ke halaman MDO yang baru.

---

## 3. Halaman Baru: MDO & Final Review Workspace (`/mdo`)

Menggantikan `app/review/page.tsx` secara menyeluruh sebagai ruang kerja final sebelum ekspor data.

### A. Komponen Utama Halaman MDO
1. **Header Workspace:**
   - Nama Dokumen yang aktif & switch dokumen.
   - Status Progres MDO (Total Assets, Approved, Pending, Rejected).
   - **Input Location Prefix:** Kolom isian teks (misal: `GRS`, `MTR`, `JRG SECT1`) yang menjadi prefix otomatis perakitan Description.
2. **Action Bar:**
   - **Tombol "Analyze Process Flow with AI" / "Build MDO":** Memicu Vision AI untuk membaca gambar P&ID, menelusuri garis pipa dan arah panah aliran, lalu mengisi otomatis kolom *From, To, Of, Size*.
   - **Tombol "Approve All":** Menyetujui semua record MDO yang berstatus PENDING.
   - **Tombol "Export Asset Register (MDO Excel)":** Mengunduh spreadsheet Excel resmi 8 kolom.
3. **Tabel Data MDO (Full Customization):**
   - Menampilkan 8 kolom standar:
     1. `Equipment Tag` (Bisa diedit)
     2. `Short for Equipment Type` (Bisa diedit, default dari Legend/ISA 5.1)
     3. `Equipment Name` (Bisa diedit, default dari nama tipe)
     4. `Size` (Bisa diedit, format nominal e.g. `1/2"`, `2"`, `4"`)
     5. `From` (Bisa diedit)
     6. `To` (Bisa diedit)
     7. `Of` (Bisa diedit)
     8. `Description` (Ter-recalculate otomatis saat atribut diubah, atau bisa di-override manual)
   - Kolom Status Persetujuan (`PENDING` / `APPROVED` / `REJECTED`) & Quick Action (Approve / Reject).
4. **Modal / Drawer Editor Detail:**
   - Memungkinkan pengguna mengubah nilai detail aset apa pun dengan pratinjau langsung kalimat deskripsi (*Live Description Preview*).

---

## 4. Kaidah Formula Description (PT Accenture Indonesia)

Sesuai Slide 20 & 21:
$$\mathbf{OUTPUT} = [\text{Prefix-}] + \mathbf{Equipment\ Type} + [\mathbf{Size}] + [\mathbf{OF\ \dots}] + [\mathbf{FROM\ \dots}] + [\mathbf{TO\ \dots}]$$

### Prinsip *Clean Omission*:
Bagian yang tidak terisi / bernilai kosong tidak boleh dipaksakan masuk.
- Jika `FROM` kosong $\rightarrow$ langsung lompat ke `TO` (tanpa menyisakan kata "FROM").
- Jika `Size` kosong $\rightarrow$ ditiadakan (tanpa spasi/petik kosong).
- Jika `Prefix` kosong $\rightarrow$ langsung dimulai dari nama/singkatan peralatan.

Contoh hasil formulasi:
- `MTR-PIPE 2" OF METERING B TO VENT`
- `MTR-PIPE 2" OF PIGR PHASE 2 FROM GRS TO SUMP TANK`
- `MTR-PRESS GAUGE OF JMPR LINE TO S CATCHER`
- `GRS-PT 1/2" OF HEADER LINE TO PRESSURE TRANSMITTER A`

---

## 5. Vision AI Process Flow Analyzer (`lib/mdo-ai-analyzer.ts`)

AI Vision Multi-Provider (Gemini, Claude, OpenAI) membaca gambar halaman P&ID resolusi tinggi dengan instruksi teknis:
1. Menemukan koordinat bounding box setiap target aset pada diagram.
2. Menelusuri jalur pipa fisik yang terhubung ke inlet dan outlet port aset.
3. Mendeteksi panah aliran proses (*process flow arrowheads*) untuk membedakan arah Hulu (*Source/From*) dan Hilir (*Destination/To*).
4. Mengidentifikasi label line header induk (*Of*) dan spesifikasi ukuran pipa (*Size*).
5. Mengembalikan struktur JSON terstandarisasi untuk dirakit oleh *Dynamic Rule-Engine*.

---

## 6. Rencana Perubahan Kode & File

| No | Tindakan | Target File | Keterangan |
|:---|:---|:---|:---|
| **1** | Hapus | `app/review/page.tsx` | Menghapus halaman review lama beserta sub-komponennya. |
| **2** | Perbarui Navigasi | [app/sidebar-nav.tsx](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/sidebar-nav.tsx) & [app/page.tsx](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/page.tsx) | Mengganti tautan `/review` menjadi `/mdo` ("MDO Process Flow"). |
| **3** | Buat Halaman Baru | `app/mdo/page.tsx` | Halaman MDO lengkap dengan tabel 8 kolom, inline edit, trigger AI alur, dan ekspor Excel. |
| **4** | Bersihkan & Sederhanakan | [app/detection/page.tsx](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/detection/page.tsx) | Menghapus tombol & drawer MDO dari detection; memfokuskan viewer & tombol "Proceed to MDO". |
| **5** | Modul Description Rule | `lib/mdo-description.ts` | Logika deterministik perakitan kalimat deskripsi Accenture & *clean omission*. |
| **6** | Skema Database | `sql/migrate-mdo-accenture-8cols.sql` | Memperbarui tabel `detection_mdo_records` ke 8 kolom definitif + `location_prefix`. |
| **7** | API Routes | `app/api/documents/[id]/mdo/route.ts` & `export/route.ts` | Endpoint build MDO, simpan edit kustomisasi, dan ekspor Excel 8 kolom. |
| **8** | AI Vision Flow Analyzer | `lib/mdo-ai-analyzer.ts` | Multi-provider visual pipe & flow tracing. |
| **9** | Testing & Validasi | `__tests__/mdo-description.test.ts`, `__tests__/mdo-route.test.ts` | Menjamin 100% tes lulus dan bebas regresi. |
