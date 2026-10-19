import { buildAssetRegisterWorkbook, type ExportAsset } from '@/lib/excel-export';
import ExcelJS from 'exceljs';

describe('Excel Export Valve Size Alignment', () => {
  it('exports dedicated Size column with correct header and value', async () => {
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
    await wb.xlsx.load(buf as any);

    const ws = wb.getWorksheet('Asset Register');
    expect(ws).toBeDefined();

    // Row 3 headers: Column 6 (F) must be "Size"
    const sizeHeaderCell = ws?.getCell('F3');
    expect(sizeHeaderCell?.value).toBe('Size');

    // Row 4 data: Column 6 (F) must contain "4\""
    const sizeDataCell = ws?.getCell('F4');
    expect(sizeDataCell?.value).toBe('4"');

    // From and To must be separate columns
    expect(ws?.getCell('G3')?.value).toBe('From');
    expect(ws?.getCell('G4')?.value).toBe('TK-101');
    expect(ws?.getCell('H3')?.value).toBe('To');
    expect(ws?.getCell('H4')?.value).toBe('P-101');
  });
});
