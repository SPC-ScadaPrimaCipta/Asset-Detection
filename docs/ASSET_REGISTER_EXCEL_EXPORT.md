# Asset Register Excel Export Specification
## P&ID-Based Asset Register Template

| Informasi | Detail |
|---|---|
| Document Name | Asset Register Excel Export Specification |
| Version | 1.1 |
| Status | Draft |
| Export Format | Microsoft Excel Workbook (`.xlsx`) |
| Data Source | Approved P&ID Detection + Manual Enrichment |
| Detection Engine | Google Gemini |
| Primary Sheet | `Asset Register` |
| Main Use Case | Export asset data hasil pembacaan P&ID ke template Asset Register |
| Default Export Rule | Hanya record berstatus `approved` |

> ## ⚠️ Status implementasi (diverifikasi terhadap `lib/excel-export.ts`)
>
> Dokumen ini adalah **spesifikasi**; bukan deskripsi kode yang berjalan. Yang
> sudah ada di `lib/excel-export.ts` + `app/api/export/assets/route.ts`:
>
> - ✅ 5 sheet dengan nama persis seperti di sini: `Asset Register`,
>   `Equipment Summary`, `Detection Summary`, `Legend Used`, `Detection Evidence`.
> - ✅ Record `REJECTED` (di `detectionStatus` **atau** `reviewStatus`) tidak pernah
>   masuk sheet Asset Register.
> - ✅ Review items dikendalikan query param
>   `?includeReviewItems=true`. Default-nya **tidak** memasukkan record dengan
>   `reviewStatus = 'PENDING'`. Ini yang dimaksud baris "Default Export Rule" di atas.
>
> Yang **belum** ada dan tetap spesifikasi: kolom SAP/weight/UOM/size-dimension,
> nomor dokumen & revisi P&ID, reviewer/approver terpisah, dan sheet `Exceptions`.
>
> ### ⚠️ Diskrepansi band confidence yang perlu diketahui
>
> Sheet `Detection Summary` saat ini memakai band **hardcoded 0.95 / 0.80 / <0.80**
> (`lib/excel-export.ts:155-157`). Angka itu **tidak** mencerminkan logika aplikasi:
>
> | | Nilai di app |
> |---|---|
> | Sinyal review sebenarnya | `reviewStatus === 'PENDING'` |
> | Threshold confidence | `DETECTION_REVIEW_THRESHOLD`, default **0.65** |
> | Status validasi | `VALID` / `NEEDS_REVIEW` / `CONFLICT` — **tidak ada** band High/Medium/Low |
>
> Jadi label "Needs Review (<0.80)" di sheet Detection Summary menghitung
> sesuatu yang berbeda dari apa yang disebut "needs review" di UI. Ini **bug
> pelaporan**, bukan keputusan spec — sheet itu sebaiknya memakai
> `reviewStatus`/`validation_status` dan threshold yang sama dengan aplikasi.

---

## 1. Purpose

Dokumen ini mendefinisikan format Excel Asset Register berdasarkan template bisnis yang digunakan pada proyek P&ID.

Format ini mendukung pembuatan record asset seperti valve, pump, vessel, instrument, dan equipment lain dari hasil pembacaan P&ID. Setiap record harus dapat ditelusuri kembali ke:

- Project atau plant area.
- P&ID document number.
- P&ID revision.
- P&ID page.
- Tag number.
- Symbol reference dari Legend Library.
- Hasil detection Gemini.
- Reviewer dan approver.

Output Excel harus membantu proses review, enrichment, dan import ke sistem asset management atau SAP.

---

## 2. Core Output Principle

Sistem membagi kolom Asset Register menjadi tiga sumber data.

| Data Source | Examples | Rule |
|---|---|---|
| Gemini + P&ID | Tag number, equipment type, size, from, to, proposed description | Hanya diisi jika terlihat jelas pada P&ID |
| Legend/Mapping Rule | Class, object type, type, equipment type mapping | Berasal dari Approved Legend Library dan company mapping |
| Manual/SAP Enrichment | Weight, UOM, inventory number, acquisition value, currency, dates | Tidak boleh dibuat atau ditebak Gemini |

```text
P&ID PDF
    │
    ▼
Gemini Extraction
    │
    ├── Tag Number
    ├── Equipment Type
    ├── Size
    ├── From
    ├── To
    └── Description Proposal
    │
    ▼
Legend / Company Mapping
    │
    ├── Class
    ├── Object Type
    └── Type
    │
    ▼
Manual / SAP Enrichment
    │
    ├── Weight
    ├── Inventory Number
    ├── Acquisition Value
    └── Acquisition Date
    │
    ▼
Asset Register Excel Export
```

---

## 3. Required Asset Register Column Order

Kolom Excel harus mengikuti urutan berikut.

| No. | Header Name | Field Key | SAP/Business Code | Length | Source |
|---:|---|---|---|---:|---|
| 1 | # | `rowNumber` | N/A | System | System |
| 2 | Equipment | `equipment` | `EQUIPMENT` | System | System generated |
| 3 | Tag No Proposed | `tagNoProposed` | `TAG_NO_PROPOSED` | Configurable | Gemini + reviewer |
| 4 | Equipment Type | `equipmentType` | `EQART` | 10 | Gemini + mapping |
| 5 | For Description | `forDescription` | `FOR_DESCRIPTION` | Configurable | Gemini + reviewer |
| 6 | Size | `size` | `SIZE` | 18 | Gemini/P&ID |
| 7 | From | `fromValue` | `FROM_VALUE` | Configurable | Gemini/P&ID |
| 8 | To | `toValue` | `TO_VALUE` | Configurable | Gemini/P&ID |
| 9 | Of | `ofValue` | `OF_VALUE` | Configurable | Gemini/P&ID/manual |
| 10 | At | `atValue` | `AT_VALUE` | Configurable | Gemini/P&ID/manual |
| 11 | Tag Number | `tagNumber` | `TAG_NUMBER` | Configurable | Approved detection |
| 12 | Alternative Description by ACN (OLD) | `alternativeDescriptionByAcnOld` | `ALT_DESC_ACN_OLD` | Configurable | Legacy ACN/manual |
| 13 | Alternative Description by ACN | `alternativeDescriptionByAcn` | `ALT_DESC_ACN` | Configurable | ACN/manual |
| 14 | Description Proposed | `descriptionProposed` | `DESCRIPTION_PROPOSED` | Configurable | System + reviewer |
| 15 | Description | `description` | `DESCRIPTION` | Configurable | Reviewer/approver |
| 16 | Len | `descriptionLength` | `DESCRIPTION_LENGTH` | System | System calculated |
| 17 | Class | `klasse` | `KLASSE` | 18 | Company mapping |
| 18 | Object | `objectType` | `OBJECT_TYPE` | Configurable | Company mapping |
| 19 | Type | `type` | `TYPE` | Configurable | Company mapping |
| 20 | Weight | `weight` | `BRGEW` | 17 | SAP/datasheet/manual |
| 21 | UOM | `weightUom` | `GEWEI` | 3 | SAP/datasheet/manual |
| 22 | Inventory No. | `inventoryNumber` | `INVNR` | 25 | SAP/manual |
| 23 | Size/Dimension | `sizeDimension` | `GROES` | 18 | Datasheet/P&ID/manual |
| 24 | Start-up Date | `startupDate` | `INBDT` | 8 | SAP/commissioning/manual |
| 25 | Acquisition Value | `acquisitionValue` | `ANSWT` | 17 | SAP/finance/manual |
| 26 | Currency | `currency` | `WAERS` | 4 | SAP/finance/manual |
| 27 | Acquisition Date | `acquisitionDate` | `ANSDT` | 17 | SAP/finance/manual |
| 28 | Location | `location` | `STORT` | 10 | Project/P&ID/manual |
| 29 | Manufacture Drawing No. | `manufactureDrawingNumber` | `HZEIN` | 45 | Document metadata/P&ID |

> Kolom `#` adalah nomor urut record pada Excel. Kolom ini tidak perlu disimpan sebagai field tetap di database.

---

## 4. SAP Field Constraints

Kolom berikut memiliki batas panjang berdasarkan template yang diberikan.

| Field Code | Header | Maximum Length | Notes |
|---|---|---:|---|
| `KLASSE` | Class | 18 | Company/asset classification |
| `EQART` | Equipment Type | 10 | Equipment type |
| `BRGEW` | Weight | 17 | Numeric weight value |
| `GEWEI` | UOM | 3 | Unit of measure, for example `KG` |
| `INVNR` | Inventory No. | 25 | Inventory number |
| `GROES` | Size/Dimension | 18 | Dimension/size |
| `INBDT` | Start-up Date | 8 | Date field, recommended `YYYYMMDD` for SAP integration |
| `ANSWT` | Acquisition Value | 17 | Numeric financial value |
| `WAERS` | Currency | 4 | Currency code, for example `IDR` or `USD` |
| `ANSDT` | Acquisition Date | 17 | Date field; format must follow target SAP import requirement |
| `STORT` | Location | 10 | Location code or plant location |
| `HZEIN` | Manufacture Drawing No. | 45 | Manufacturer drawing/reference number |

---

## 5. Meaning of Core P&ID Fields

### 5.1 Equipment

`Equipment` adalah ID asset/equipment internal atau ID yang diterbitkan SAP.

Contoh:

```text
EQ-000001
EQ-000002
```

Pada contoh source Anda, angka `4` dan `5` digunakan sebagai nomor urut item. Untuk sistem baru, disarankan membedakan:

```text
#              = nomor urut Excel
Equipment      = asset/equipment ID
Tag Number     = tag dari P&ID
```

### 5.2 Tag No Proposed

`Tag No Proposed` adalah tag hasil pembacaan P&ID atau hasil proposal dari Gemini sebelum disetujui.

Contoh:

```text
30756-BV-1001
30756-BV-3001
```

### 5.3 Equipment Type

`Equipment Type` adalah kode tipe asset/equipment.

Contoh pada data Anda:

```text
BV
```

Nilai `BV` dapat dimaknai sesuai kamus internal organisasi, misalnya:

```text
BV = Block Valve
BV = Ball Valve
BV = Butterfly Valve
```

Karena makna kode dapat berbeda antar organisasi, sistem harus memakai **Equipment Type Dictionary** yang dikelola Admin/Engineer.

### 5.4 For Description

`For Description` adalah informasi kontekstual yang dipakai untuk menyusun description asset.

Contoh:

```text
CONOCO PHILLIPS
VENT ISOLATION VALVE
```

Field ini dapat berasal dari label P&ID, service description, equipment destination, atau review engineer.

### 5.5 Size

`Size` menyimpan ukuran proses atau nominal diameter.

Contoh:

```text
24
2
```

Untuk valve/piping, field ini dapat merepresentasikan nominal pipe size.

### 5.6 From and To

Field `From` dan `To` mendeskripsikan hubungan atau arah asset pada P&ID.

Contoh pertama:

```text
From = CONOCO PHILLIPS
To   = SDV-1012
```

Contoh kedua:

```text
From = [blank]
To   = VENT ISOLATION VALVE
```

Gemini hanya boleh mengisi field tersebut bila nama sumber atau tujuan benar-benar terbaca dari P&ID.

### 5.7 Description Proposed

`Description Proposed` adalah deskripsi yang dihasilkan sistem sebelum final review.

Contoh:

```text
GRS-BV 24" FROM CONOCO PHILLIPS TO SDV-1012
GRS-BV 2" TO SDV-1012 (11-BV-3001)
```

### 5.8 Description

`Description` adalah deskripsi final yang digunakan pada Asset Register.

Contoh:

```text
GRS-BV 24" FROM CONOCO PHILLIPS TO SDV-1012
GRS-BV 2" TO VENT ISOLATION VALVE
```

### 5.9 Len

`Len` adalah jumlah karakter pada `Description`.

Contoh:

```text
Description:
GRS-BV 24" FROM CONOCO PHILLIPS TO SDV-1012

Len:
43
```

Sistem harus menghitung field ini secara otomatis menggunakan formula:

```text
Len = jumlah karakter pada Description
```

Contoh TypeScript:

```ts
const descriptionLength = description?.length ?? 0;
```

### 5.10 Class, Object, and Type

Dari contoh, field `Class` berisi:

```text
VALVES
```

Struktur mapping yang disarankan:

| Field | Example | Source |
|---|---|---|
| Class | `VALVES` | Company mapping |
| Object | `VALVE` | Company mapping |
| Type | `BLOCK VALVE` / `BALL VALVE` / `BUTTERFLY VALVE` | Legend + company mapping |

Jika organization standard hanya memakai `Class`, field `Object` dan `Type` tetap sebaiknya tersedia agar struktur dapat digunakan untuk asset lain seperti pump, vessel, instrument, dan equipment package.

### 5.11 Location

Dari contoh, `Location` berisi:

```text
GRS
```

`GRS` kemungkinan adalah location/plant/area code. Sistem harus mengambil nilai ini dari salah satu sumber berikut:

1. Project metadata.
2. P&ID document metadata.
3. Area/unit pada P&ID.
4. Field manual user.
5. Default location yang ditetapkan pada project.

### 5.12 Manufacture Drawing No.

Contoh:

```text
SNA-ASR-GRS-DWG-PID-0001
```

Field ini diisi dari P&ID document number, drawing number, atau manufacture drawing reference.

---

## 6. Description Generation Rules

### 6.1 Valve Description Rule

Untuk class `VALVES`, system harus mendukung formula description berikut:

```text
[Location]-[Equipment Type] [Size]" FROM [From] TO [To]
```

Contoh:

```text
GRS-BV 24" FROM CONOCO PHILLIPS TO SDV-1012
```

Jika `From` kosong:

```text
[Location]-[Equipment Type] [Size]" TO [To]
```

Contoh:

```text
GRS-BV 2" TO VENT ISOLATION VALVE
```

### 6.2 Proposed Description Rule

Proposed description dapat mempertahankan reference tag tambahan jika terlihat pada P&ID.

```text
[Location]-[Equipment Type] [Size]" TO [To] ([Related Tag])
```

Contoh:

```text
GRS-BV 2" TO SDV-1012 (11-BV-3001)
```

### 6.3 Description Generation Priority

```text
1. Gunakan Description yang telah diedit/review user.
2. Jika belum ada, gunakan Description Proposed.
3. Jika belum ada, buat description dari formula sesuai asset class.
4. Jika data formula tidak cukup, jangan membuat asumsi.
5. Tandai record sebagai needs_review atau needs_enrichment.
```

### 6.4 Description Formatting

- Semua description menggunakan uppercase.
- Gunakan format inch untuk size valve/piping: `24"` atau `2"`.
- Gunakan separator hyphen antara location dan equipment type.
- Gunakan kata `FROM` dan `TO` untuk hubungan source-destination.
- Jangan menambahkan `FROM` jika source tidak tersedia.
- Jangan menambahkan `TO` jika destination tidak tersedia.
- Jangan membuat destination hanya dari asumsi tag terdekat.
- Hitung panjang description setelah uppercase dan trimming.

---

## 7. Example Rows Based on Source Template

### 7.1 Example 1 — 24 Inch Valve

| # | Equipment | Tag No Proposed | Equipment Type | For Description | Size | From | To | Of | At | Tag Number | Alternative Description by ACN (OLD) | Alternative Description by ACN | Description Proposed | Description | Len | Class | Object | Type | Weight | UOM | Inventory No. | Size/Dimension | Start-up Date | Acquisition Value | Currency | Acquisition Date | Location | Manufacture Drawing No. |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---:|---|---|---|---:|---|---|---|---|---:|---|---|---|---|
| 4 |  | `30756-BV-1001` | `BV` | `CONOCO PHILLIPS` | `24` | `CONOCO PHILLIPS` | `SDV-1012` |  |  | `30756-BV-1001` |  |  | `GRS-BV 24" FROM CONOCO PHILLIPS TO SDV-1012` | `GRS-BV 24" FROM CONOCO PHILLIPS TO SDV-1012` | 43 | `VALVES` |  |  |  |  |  | `24` |  |  |  | `GRS` | `SNA-ASR-GRS-DWG-PID-0001` |

### 7.2 Example 2 — 2 Inch Vent Isolation Valve

| # | Equipment | Tag No Proposed | Equipment Type | For Description | Size | From | To | Of | At | Tag Number | Alternative Description by ACN (OLD) | Alternative Description by ACN | Description Proposed | Description | Len | Class | Object | Type | Weight | UOM | Inventory No. | Size/Dimension | Start-up Date | Acquisition Value | Currency | Acquisition Date | Location | Manufacture Drawing No. |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---:|---|---|---|---:|---|---|---|---|---:|---|---|---|---|
| 5 |  | `30756-BV-3001` | `BV` | `VENT ISOLATION VALVE` | `2` |  | `VENT ISOLATION VALVE` |  |  | `30756-BV-3001` |  |  | `GRS-BV 2" TO SDV-1012 (11-BV-3001)` | `GRS-BV 2" TO VENT ISOLATION VALVE` | 33 | `VALVES` |  |  |  |  |  | `2` |  |  |  | `GRS` | `SNA-ASR-GRS-DWG-PID-0001` |

> Catatan: Nilai pada `Description Proposed` dan `Description` dapat berbeda. `Description Proposed` merupakan hasil extraction/AI. `Description` merupakan hasil akhir setelah correction oleh engineer atau Asset Manager.

---

## 8. Gemini Extraction Schema Extension

Gemini perlu diminta mengekstrak field P&ID yang mendukung template Asset Register.

```json
{
  "page_number": 1,
  "assets": [
    {
      "tag_no_proposed": "30756-BV-1001",
      "equipment_type": "BV",
      "for_description": "CONOCO PHILLIPS",
      "size": "24",
      "from_value": "CONOCO PHILLIPS",
      "to_value": "SDV-1012",
      "of_value": null,
      "at_value": null,
      "tag_number": "30756-BV-1001",
      "description_proposed": "GRS-BV 24\" FROM CONOCO PHILLIPS TO SDV-1012",
      "asset_class": "VALVES",
      "symbol_code": "BLOCK_VALVE",
      "page_number": 1,
      "review_required": false,
      "review_reason": null,
      "overall_confidence": 0.91
    }
  ]
}
```

### 8.1 Gemini Rules for These Fields

Gemini must follow these rules:

```text
- Extract tag_no_proposed only when the tag is visibly readable.
- Extract equipment_type only when the type code is visible or explicitly mapped by the approved legend.
- Extract size only when a nominal size or dimension is visibly shown.
- Extract from_value and to_value only when source/destination text is visible or clearly associated with the asset.
- Do not infer From/To from the nearest equipment without visual evidence.
- Do not populate Weight, UOM, Inventory Number, Start-up Date, Acquisition Value, Currency, or Acquisition Date.
- Return null for missing or unreadable values.
- Create description_proposed only from visible values and configured description rules.
- Set review_required to true when any input of description_proposed is uncertain.
```

---

## 9. Export Validation Rules

### 9.1 Mandatory Fields for Final Export

| Field | Rule |
|---|---|
| Tag No Proposed | Wajib tersedia atau memiliki alasan review yang disetujui |
| Equipment Type | Wajib tersedia untuk record equipment/valve/instrument |
| Tag Number | Wajib untuk Final Export |
| Description Proposed | Wajib tersedia |
| Description | Wajib tersedia dan sudah approved |
| Len | Harus sama dengan length Description |
| Class | Wajib tersedia |
| Location | Wajib jika project template mewajibkan |
| Manufacture Drawing No. | Wajib jika project template mewajibkan |
| Verification Status | Harus `approved` |
| Duplicate Tag | Tidak boleh memiliki unresolved duplicate warning |

### 9.2 Optional Enrichment Fields

Nilai berikut dapat kosong pada Final P&ID Asset Register, kecuali project/SAP import template mewajibkannya:

```text
Weight
UOM
Inventory No.
Start-up Date
Acquisition Value
Currency
Acquisition Date
Alternative Description by ACN (OLD)
Alternative Description by ACN
Object
Type
```

Jika field finance atau physical asset belum lengkap, record memiliki status:

```text
needs_enrichment
```

### 9.3 Field Length Validation

```text
KLASSE <= 18 characters
EQART <= 10 characters
BRGEW <= 17 characters
GEWEI <= 3 characters
INVNR <= 25 characters
GROES <= 18 characters
INBDT <= 8 characters
ANSWT <= 17 characters
WAERS <= 4 characters
ANSDT <= 17 characters
STORT <= 10 characters
HZEIN <= 45 characters
```

Jika nilai melewati batas:

```text
1. Sistem menandai field sebagai invalid.
2. Record masuk ke sheet Exceptions.
3. Final SAP-ready export diblokir sampai nilai dikoreksi.
4. Sistem tidak boleh melakukan truncation otomatis tanpa persetujuan user.
```

---

## 10. Excel Formatting Rules

### 10.1 Header Style

| Property | Value |
|---|---|
| Header Font | Bold, white |
| Header Fill | Dark blue |
| Header Alignment | Center, vertical center, wrap text |
| Header Border | Thin border |
| Freeze Pane | Row 1 |
| Filter | Active on all columns |
| Auto Width | Yes, with configured maximum width |

### 10.2 Data Formatting

| Field Type | Excel Format |
|---|---|
| Tag Number | Text (`@`) |
| Equipment | Text (`@`) |
| Equipment Type | Text (`@`) |
| Size | Text (`@`) |
| Weight | `#,##0.000` |
| Acquisition Value | `#,##0.00` |
| Start-up Date | `yyyy-mm-dd` or SAP configured format |
| Acquisition Date | `yyyy-mm-dd` or SAP configured format |
| Confidence | `0.00%` |
| Description | Wrap text |
| Long Reason Fields | Wrap text |
| Boolean Warning | `TRUE` / `FALSE` or `Yes` / `No` |

### 10.3 Conditional Formatting

| Condition | Formatting |
|---|---|
| `Verification Status = Approved` | Green fill |
| `Verification Status = Needs Review` | Yellow fill |
| `Verification Status = Rejected` | Red fill |
| Duplicate tag warning | Orange/red fill |
| Missing mandatory field | Red fill/border |
| `needs_enrichment` | Yellow fill |
| `ready_for_sap` | Green fill |
| Confidence below 80% | Yellow/red fill |

---

## 11. Recommended Workbook Sheets

| Sheet | Required | Purpose |
|---|---|---|
| `Asset Register` | Yes | Main Asset Register data in business/SAP format |
| `Export Summary` | Yes | Export metadata and statistics |
| `Field Dictionary` | Yes | Header and field documentation |
| `Validation Lists` | Yes | Dropdown source values |
| `Source Traceability` | Yes | P&ID, page, legend, Gemini, and review evidence |
| `Exceptions` | Should Have | Validation issue list |
| `Legend Mapping` | Should Have | Symbol → Class/Object/Type/Equipment Type mapping |

---

## 12. Export Filename Convention

```text
Asset_Register_{PROJECT_CODE}_{EXPORT_MODE}_{YYYYMMDD_HHMMSS}.xlsx
```

Examples:

```text
Asset_Register_GRS_FINAL_20260930_212600.xlsx
Asset_Register_GRS_REVIEW_20260930_212600.xlsx
Asset_Register_GRS_SNA-ASR-GRS-DWG-PID-0001_20260930_212600.xlsx
```

---

## 13. Definition of Done

Excel Asset Register Export is complete when:

- Workbook dapat dibuat dalam format `.xlsx`.
- Sheet `Asset Register` mengikuti urutan kolom bisnis yang ditentukan.
- Kolom `#` dibuat otomatis sebagai row number.
- Gemini hanya mengisi field yang dapat dibuktikan dari P&ID/Legend.
- Field finance, inventory, weight, dan acquisition tidak diisi AI tanpa sumber data valid.
- Description Proposed dapat dibuat berdasarkan rule yang dikonfigurasi.
- Description final dapat diedit dan harus disetujui.
- Kolom `Len` otomatis menghitung panjang Description.
- Nilai KLASSE, EQART, BRGEW, GEWEI, INVNR, GROES, INBDT, ANSWT, WAERS, ANSDT, STORT, dan HZEIN divalidasi sesuai batas panjang.
- Workbook memiliki sheet Summary, Dictionary, Validation Lists, Traceability, dan Exceptions.
- Header diformat, filter aktif, dan row pertama di-freeze.
- Hanya asset dengan status `approved` dapat dimasukkan dalam Final Export.
- Semua export dicatat dengan export batch ID dan audit log.