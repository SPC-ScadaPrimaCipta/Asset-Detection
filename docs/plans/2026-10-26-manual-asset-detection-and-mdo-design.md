# Design Document: Manual Asset Addition in Detection & Asset Register Removal

**Date:** 2026-10-26  
**Status:** Approved by User  
**Scope:** Frontend (Detection Viewer, Navigation, App Cleanup), Backend (Manual Detection API, MDO Flow Integration)

---

## 1. Executive Summary & User Objectives

1. **Penghapusan Asset Register**: Alur aplikasi kini telah memiliki alur **MDO Flow** yang lebih komprehensif. Halaman `/assets` dan `/asset-register` dihapus secara total dari aplikasi dan navigasi.
2. **Penambahan Asset Manual di Detection Viewer**: Menambahkan fitur seleksi bounding box interaktif pada PDF preview di halaman `/detection`. Pengguna dapat mengaktifkan mode drawing, menarik kotak di atas gambar P&ID, dan mengisi kelengkapan metadata asset (Tag, Tipe, Deskripsi, Service, Size).
3. **Penyelarasan MDO Flow**: Asset yang ditambahkan secara manual otomatis berstatus `MANUAL` & `APPROVED` dengan confidence `1.0`. Saat pengguna melanjutkan ke `/mdo`, generator MDO otomatis mengikutsertakan asset manual tersebut dalam pemetaan alur proses (process flow) dan perakitan deskripsi standar MDO.

---

## 2. Penghapusan Halaman Asset Register

### Tindakan:
* Hapus file/folder:
  * `app/assets/page.tsx` dan folder `app/assets`
  * `app/asset-register/page.tsx` dan folder `app/asset-register`
* Perbarui navigasi [app/sidebar-nav.tsx](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/sidebar-nav.tsx):
  * Hapus entri `{ href: '/assets', label: 'Asset Register', icon: Layers }` dari `MENU_ITEMS`.
* Perbarui dashboard [app/page.tsx](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/page.tsx):
  * Hapus tautan dan kartu yang merujuk ke `/assets` atau `/asset-register`.
* Perbarui tautan di halaman lain (jika ada) yang mengarah ke `/assets`.

---

## 3. Fitur Seleksi Manual pada PDF Viewer ([app/detection/page.tsx](file:///c:/Users/SrydenID/Documents/GitHub/Asset-Detection/app/detection/page.tsx))

### 3.1. Mode Drawing Bounding Box
* Ditambahkan tombol toggle di viewer toolbar: `+ Add Asset Manual` (disertai ikon `Plus` / `BoundingBox`).
* State lokal:
  * `isDrawingMode: boolean`
  * `drawingStart: { x: number; y: number } | null`
  * `currentRect: { x: number; y: number; w: number; h: number } | null`
* Saat `isDrawingMode === true`:
  * Pointer cursor menjadi `crosshair`.
  * Mode pan/drag dinonaktifkan sementara.
  * Interaksi mouse dihitung terhadap kontainer gambar dalam skala koordinat 0 s/d 1000 (sesuai SVG viewBox `0 0 1000 1000`).
  * Preview persegi panjang semi-transparan ditampilkan saat drag berlangsung.
  * Saat `mouseup`, jika ukuran kotak valid (lebar > 10 unit dan tinggi > 10 unit), kotak disimpan ke state `newAssetBbox` dan membuka modal `AddManualAssetModal`. Mode drawing otomatis dimatikan kembali.

### 3.2. Modal Dialog `AddManualAssetModal`
* Form fields:
  * **Asset Tag** (wajib, input teks dengan validasi format standar)
  * **Asset Type** (wajib, select / autocomplete: Pump, Vessel, Heat Exchanger, Valve, Control Valve, Tank, Compressor, Filter, Instrument, dll.)
  * **Description** (opsional)
  * **Service** (opsional)
  * **Size** (opsional)
  * Informasi koordinat BBox & Halaman P&ID terlampir otomatis.
* Aksi:
  * **Cancel**: Menutup modal dan membatalkan penambahan.
  * **Save Asset**: Mengirim data ke API backend, menambahkan asset langsung ke tabel deteksi dan state lokal viewer.

---

## 4. Backend API: `POST /api/detections/manual`

### Endpoint:
`POST /api/detections/manual`

### Request Body:
```json
{
  "documentId": "uuid",
  "pidPage": 1,
  "assetTag": "P-101A",
  "assetType": "Pump",
  "description": "Crude Oil Booster Pump",
  "service": "Hydrocarbon",
  "size": "4 inch",
  "bbox": {
    "x": 350,
    "y": 420,
    "width": 60,
    "height": 60
  }
}
```

### Response (201 Created):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "document_id": "uuid",
    "asset_tag": "P-101A",
    "asset_type": "Pump",
    "description": "Crude Oil Booster Pump",
    "service": "Hydrocarbon",
    "size": "4 inch",
    "pid_page": 1,
    "confidence": 1.0,
    "detection_status": "MANUAL",
    "review_status": "APPROVED",
    "bbox_x": 350,
    "bbox_y": 420,
    "bbox_w": 60,
    "bbox_h": 60,
    "created_at": "timestamp"
  }
}
```

---

## 5. Integrasi dengan MDO Flow

* Generator MDO di `/api/documents/[id]/mdo` mengeksekusi query:
  ```sql
  SELECT id, asset_tag, asset_type, description, size, pid_page, bbox_x, bbox_y, bbox_w, bbox_h
  FROM detections 
  WHERE document_id = $1 
    AND detection_status != 'REJECTED'
    AND (candidate_status IS NULL OR candidate_status != 'NOISE')
  ```
* Karena asset manual disimpan dengan status `detection_status = 'MANUAL'` dan `review_status = 'APPROVED'`, maka saat pengguna menekan tombol **"Proceed to MDO"** atau **"Build MDO Records"**, asset ini langsung otomatis diikutsertakan dalam perakitan proses MDO.
* Asset yang tidak terdeteksi oleh AI dan tidak ditambahkan manual oleh pengguna tidak akan pernah masuk ke MDO.
