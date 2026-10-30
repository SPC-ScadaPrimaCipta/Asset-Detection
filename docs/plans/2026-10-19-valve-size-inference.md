# Valve Size Inference from Piping Lines & Excel Asset Register Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Otomatis mendeteksi ukuran nominal valve dari nomor jalur pipa (P&ID piping lines) baik pada file CAD DXF maupun dokumen PDF, menyimpannya ke database, menampilkannya pada UI review, serta mengekspornya ke kolom mandiri `Size` pada template Excel Asset Register.

**Architecture:** Menggunakan pendekatan *Hybrid Spatial & Line Spec Extractor*. Parser regex mengekstrak nominal ukuran pipa dari notasi teks (horizontal & vertikal 90°, termasuk tanda petik lengkung `”` dan tanda strip `—`). Simbol valve yang memotong atau collinear dengan garis pipa tersebut otomatis mewarisi ukuran pipa. Hasilnya dipersistensikan ke kolom `size` di PostgreSQL dan diekspor ke kolom mandiri pada template Excel Asset Register 29 kolom.

**Tech Stack:** TypeScript, Next.js 16, PostgreSQL (`pg`), ExcelJS, Jest (`ts-jest`), Tesseract OCR / DXF Parser.

---

### Task 1: Piping Spec Parser Module (`lib/piping-parser.ts`)

**Files:**
- Create: `lib/piping-parser.ts`
- Test: `__tests__/piping-parser.test.ts`

**Step 1: Write the failing test**

```typescript
// __tests__/piping-parser.test.ts
import { parseLineSpecText, extractSizeFromLineSpec } from '@/lib/piping-parser';

describe('Piping Spec Parser', () => {
  it('parses standard horizontal imperial line specs', () => {
    const res = parseLineSpecText('2” - WS - B - 007');
    expect(res).not.toBeNull();
    expect(res?.pipeSize).toBe('2"');
    expect(res?.service).toBe('WS');
    expect(res?.spec).toBe('B-007');
  });

  it('parses complex multi-part line specs', () => {
    const res = parseLineSpecText('4” - NG - B3CS2F - 01 - 004');
    expect(res).not.toBeNull();
    expect(res?.pipeSize).toBe('4"');
    expect(res?.service).toBe('NG');
    expect(res?.spec).toBe('B3CS2F-01-004');
  });

  it('parses vertical rotated specs with em-dash and straight quotes', () => {
    const res = parseLineSpecText('4" - NG - B8CS2F - A1 - 008');
    expect(res).not.toBeNull();
    expect(res?.pipeSize).toBe('4"');
    expect(res?.service).toBe('NG');
  });

  it('parses fractional and metric pipe sizes', () => {
    expect(extractSizeFromLineSpec('1-1/2" - P - 1001')).toBe('1-1/2"');
    expect(extractSizeFromLineSpec('1/2"-IA-200')).toBe('1/2"');
    expect(extractSizeFromLineSpec('DN100 - P - 1001')).toBe('DN100');
    expect(extractSizeFromLineSpec('DN 50 - HC - 2001')).toBe('DN50');
  });

  it('returns null for unrelated text strings', () => {
    expect(parseLineSpecText('FLOW TRANSMITTER')).toBeNull();
    expect(parseLineSpecText('P-101A')).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/piping-parser.test.ts`  
Expected: FAIL with module `@/lib/piping-parser` not found.

**Step 3: Write minimal implementation**

```typescript
// lib/piping-parser.ts
export interface ParsedLineSpec {
  rawText: string;
  pipeSize: string;
  service?: string;
  spec?: string;
}

const PIPE_SIZE_REGEX = /^(\d+(?:\s*-\s*\d+)?(?:\/\d+)?|\d+(?:\.\d+)?)\s*["”'’]|^(DN\s*\d+)/i;

export function extractSizeFromLineSpec(text: string): string | null {
  if (!text) return null;
  const clean = text.trim();
  const match = clean.match(PIPE_SIZE_REGEX);
  if (!match) return null;
  if (match[2]) {
    return match[2].replace(/\s+/g, '').toUpperCase();
  }
  const numPart = match[1].replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
  return `${numPart}"`;
}

export function parseLineSpecText(text: string): ParsedLineSpec | null {
  if (!text) return null;
  const clean = text.trim();
  const pipeSize = extractSizeFromLineSpec(clean);
  if (!pipeSize) return null;

  // Split by hyphen, en-dash, or em-dash
  const parts = clean
    .replace(/^[^-\u2013\u2014]+[-\u2013\u2014]\s*/, '')
    .split(/\s*[-\u2013\u2014]\s*/);

  const service = parts[0] || undefined;
  const spec = parts.slice(1).join('-') || undefined;

  return {
    rawText: clean,
    pipeSize,
    service,
    spec,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/piping-parser.test.ts`  
Expected: PASS (5/5 tests).

**Step 5: Commit**

```bash
git add lib/piping-parser.ts __tests__/piping-parser.test.ts
git commit -m "feat(parser): add piping line spec and size extractor"
```

---

### Task 2: Persistence Repository Size Integration (`lib/detection/persistence/detection-repository.ts`)

**Files:**
- Modify: `lib/detection/persistence/detection-repository.ts`
- Test: `__tests__/detection-repository-size.test.ts`

**Step 1: Write the failing test**

```typescript
// __tests__/detection-repository-size.test.ts
import { persistDetections, type PersistableDetection, type DbLike } from '@/lib/detection/persistence/detection-repository';

describe('Detection Repository Size Field', () => {
  it('includes size in SQL INSERT parameters', async () => {
    const executedQueries: { text: string; params: unknown[] }[] = [];
    const mockDb: DbLike = {
      query: async (text: string, params: unknown[]) => {
        executedQueries.push({ text, params });
        return { rows: [] };
      },
    };

    const det: PersistableDetection = {
      assetTag: 'VLV-001',
      assetType: 'Valve',
      confidence: 0.95,
      bbox: { x: 10, y: 10, width: 20, height: 20 },
      evidence: ['Symbol detected'],
      size: '4"',
    };

    await persistDetections(mockDb, {
      jobId: '00000000-0000-0000-0000-000000000001',
      documentId: '00000000-0000-0000-0000-000000000002',
      documentPageId: '00000000-0000-0000-0000-000000000003',
      pageNumber: 1,
      detections: [det],
    });

    const insertQuery = executedQueries.find(q => q.text.includes('INSERT INTO detections'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.text).toContain('size');
    expect(insertQuery?.params).toContain('4"');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/detection-repository-size.test.ts`  
Expected: FAIL because `size` is not included in query parameters.

**Step 3: Modify `detection-repository.ts`**

- Add `size?: string | null;` to `PersistableDetection` interface.
- Add `size` to SQL INSERT columns and params array in `persistDetections`.

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/detection-repository-size.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/detection/persistence/detection-repository.ts __tests__/detection-repository-size.test.ts
git commit -m "feat(repo): persist size field in detection repository"
```

---

### Task 3: Spatial Piping Line Size Association for DXF CAD (`lib/dxf-detection.ts`)

**Files:**
- Modify: `lib/dxf-detection.ts`
- Test: `__tests__/dxf-piping-size.test.ts`

**Step 1: Write the failing test**

```typescript
// __tests__/dxf-piping-size.test.ts
import { associatePipingLinesToValves } from '@/lib/dxf-detection';

describe('DXF Piping Line Size Association', () => {
  it('associates valve with collinear pipe line size', () => {
    const lines = [
      { start: { x: 0, y: 100 }, end: { x: 500, y: 100 }, text: '4” - NG - B3CS2F - 01 - 004', size: '4"' }
    ];
    const valves = [
      { id: 'v1', x: 250, y: 100, width: 30, height: 30, assetType: 'Valve', size: null }
    ];

    const result = associatePipingLinesToValves(valves, lines);
    expect(result[0].size).toBe('4"');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/dxf-piping-size.test.ts`  
Expected: FAIL with `associatePipingLinesToValves` undefined.

**Step 3: Implement `associatePipingLinesToValves` in `lib/dxf-detection.ts`**

- Connect text lines to collinear DXF `LINE`/`LWPOLYLINE` entities.
- Find valve clusters situated on or near the line and assign `size`.

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/dxf-piping-size.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/dxf-detection.ts __tests__/dxf-piping-size.test.ts
git commit -m "feat(dxf): associate collinear piping line sizes to valves"
```

---

### Task 4: Spatial Line Association for PDF Detection (`lib/spatial-piping.ts` & `workers/detection-worker.ts`)

**Files:**
- Create: `lib/spatial-piping.ts`
- Modify: `workers/detection-worker.ts`
- Test: `__tests__/spatial-piping.test.ts`

**Step 1: Write the failing test**

```typescript
// __tests__/spatial-piping.test.ts
import { associateNearestPipingSize } from '@/lib/spatial-piping';

describe('Spatial Piping Size Association for PDF', () => {
  it('assigns size from nearest horizontal pipe label', () => {
    const valveBbox = { x: 100, y: 200, width: 40, height: 40 };
    const textTokens = [
      { text: '2” - WS - B - 007', bbox: { x: 80, y: 180, width: 120, height: 16 } },
      { text: '6” - P - 1001', bbox: { x: 800, y: 900, width: 100, height: 16 } },
    ];

    const size = associateNearestPipingSize(valveBbox, textTokens);
    expect(size).toBe('2"');
  });

  it('assigns size from nearest vertical pipe label', () => {
    const valveBbox = { x: 300, y: 500, width: 40, height: 40 };
    const textTokens = [
      { text: '4” - NG - B8CS2F - A1 - 008', bbox: { x: 280, y: 400, width: 16, height: 150 } },
    ];

    const size = associateNearestPipingSize(valveBbox, textTokens);
    expect(size).toBe('4"');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/spatial-piping.test.ts`  
Expected: FAIL.

**Step 3: Implement `associateNearestPipingSize` in `lib/spatial-piping.ts` and integrate in `detection-worker.ts`**

- Use `parseLineSpecText` to detect pipe labels.
- Calculate distance and directional proximity (horizontal/vertical) to valve bounding box.
- Assign `detection.size` prior to persistence.

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/spatial-piping.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/spatial-piping.ts workers/detection-worker.ts __tests__/spatial-piping.test.ts
git commit -m "feat(detection): integrate spatial pipe size inference in detection worker"
```

---

### Task 5: Excel Asset Register Alignment with Dedicated Size Column (`lib/excel-export.ts`)

**Files:**
- Modify: `lib/excel-export.ts`
- Test: `__tests__/excel-export-valve-size.test.ts`

**Step 1: Write the failing test**

```typescript
// __tests__/excel-export-valve-size.test.ts
import { buildAssetRegisterWorkbook, type ExportAsset } from '@/lib/excel-export';
import ExcelJS from 'exceljs';

describe('Excel Export Valve Size Alignment', () => {
  it('exports dedicated Size column with correct header color and value', async () => {
    const assets: ExportAsset[] = [
      {
        assetTag: 'GTV-001',
        assetType: 'Gate Valve',
        size: '4"',
        tagNoProposed: 'GTV-001',
        equipmentClass: 'VALVE',
        description: 'Gate Valve 4 inch',
        confidence: 0.96,
        detectionStatus: 'DETECTED',
        reviewStatus: 'APPROVED',
        evidence: ['[Line-Size] Inferred 4" from 4"-NG-B3CS2F-01-004'],
        pidNumber: 'PID-001',
        pidPage: 1,
        service: 'NG',
        mainEquipment: null,
        location: null,
        unit: null,
        area: null,
        legend: null,
        legendSymbol: null,
        bboxX: null, bboxY: null, bboxW: null, bboxH: null,
        fromRef: 'TK-101',
        toRef: 'P-101',
        ofOrAtRef: null,
        descriptionProposed: null,
      }
    ];

    const buf = await buildAssetRegisterWorkbook(assets, 'Company Legend', { includeReviewItems: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    const ws = wb.getWorksheet('Asset Register');
    expect(ws).toBeDefined();

    // Row 3 headers: Column 6 must be "Size"
    const sizeHeaderCell = ws?.getCell('F3');
    expect(sizeHeaderCell?.value).toBe('Size');

    // Row 4 data: Column 6 must contain "4\""
    const sizeDataCell = ws?.getCell('F4');
    expect(sizeDataCell?.value).toBe('4"');

    // From and To must be separate columns
    expect(ws?.getCell('G3')?.value).toBe('From');
    expect(ws?.getCell('G4')?.value).toBe('TK-101');
    expect(ws?.getCell('H3')?.value).toBe('To');
    expect(ws?.getCell('H4')?.value).toBe('P-101');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest __tests__/excel-export-valve-size.test.ts`  
Expected: FAIL because `Size` was lumped with From/To/Of/At.

**Step 3: Modify `lib/excel-export.ts`**

- Expand Asset Register columns to match the 29-column specification with separate `Size`, `From`, `To`, `Of`, `At`.
- Format Row 3 with green background (`#70AD47`) and red text for primary engineering fields.
- Populate `a.size` directly in Column 6.

**Step 4: Run test to verify it passes**

Run: `npx jest __tests__/excel-export-valve-size.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/excel-export.ts __tests__/excel-export-valve-size.test.ts
git commit -m "feat(export): align excel asset register with dedicated size column and custom styling"
```

---

### Task 6: UI Review & Asset Register Integration (`app/detection/page.tsx` & `app/assets/page.tsx`)

**Files:**
- Modify: `app/detection/page.tsx`
- Modify: `app/assets/page.tsx`

**Step 1: Add Size column and input field in `app/detection/page.tsx`**

- Add **Size** header and row display in the detection table.
- Add **Size** editable input field in the detail drawer so users can verify or adjust the valve size before confirming.

**Step 2: Add Size column in `app/assets/page.tsx`**

- Add **Size** column in the master Asset Register table.

**Step 3: Verify build and lint**

Run: `npm run lint`  
Expected: No errors.

**Step 4: Commit**

```bash
git add app/detection/page.tsx app/assets/page.tsx
git commit -m "feat(ui): display and allow editing valve size in detection review and asset register"
```

---

### Task 7: End-to-End Verification & Documentation Report

**Files:**
- Create: `docs/reports/2026-10-19-laporan-deteksi-ukuran-valve-dan-excel-export.md`

**Step 1: Run all test suites**

Run: `npm test`  
Expected: All suites pass (including new parser, spatial piping, and Excel export tests).

**Step 2: Generate verification markdown report**

Document sample test cases, regex matches, and visual Excel confirmation.

**Step 3: Commit**

```bash
git add docs/reports/2026-10-19-laporan-deteksi-ukuran-valve-dan-excel-export.md
git commit -m "docs(report): add verification report for valve size detection and excel alignment"
```
