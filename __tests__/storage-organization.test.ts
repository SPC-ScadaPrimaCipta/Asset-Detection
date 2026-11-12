import { categorizeFilename, saveFile, getFile, fileExists, deleteFile } from '@/lib/storage';

describe('Storage file categorization', () => {
  it('categorizes legend symbol crops into legends/symbols/', () => {
    const filename = 'legend-5b722409-c706-4821-aae7-d1c8c12d7469-p1-c08f6d7131ae.png';
    const cat = categorizeFilename(filename);
    expect(cat.replace(/\\/g, '/')).toBe('legends/symbols/' + filename);
  });

  it('categorizes legend PDFs into legends/', () => {
    const filename = 'legend-f88f49f7-806d-47f4-89d0-3c5c32e384b2.pdf';
    const cat = categorizeFilename(filename);
    expect(cat.replace(/\\/g, '/')).toBe('legends/' + filename);
  });

  it('categorizes viewer rendered pages into pages/', () => {
    const filename = 'viewer-229e2227-7a79-46b5-bd9e-10da2adb3d0d-p1-s3.png';
    const cat = categorizeFilename(filename);
    expect(cat.replace(/\\/g, '/')).toBe('pages/' + filename);
  });

  it('categorizes dxf svg renders into pages/', () => {
    const filename = 'dxf-svg-1898c25d-2d77-47dd-9923-13da23d814cf-p1.svg';
    const cat = categorizeFilename(filename);
    expect(cat.replace(/\\/g, '/')).toBe('pages/' + filename);
  });

  it('categorizes uploaded P&ID PDFs and DXFs into documents/', () => {
    const pdf = 'cae30754-65fe-4c59-8ceb-b07eebb99fb9-fire_water_sp_pdt1.pdf';
    const dxf = '1f3c2131-7d05-4c94-ad1a-a19ce6e2ef67-INTAN_GS.dxf';
    expect(categorizeFilename(pdf).replace(/\\/g, '/')).toBe('documents/' + pdf);
    expect(categorizeFilename(dxf).replace(/\\/g, '/')).toBe('documents/' + dxf);
  });

  it('leaves already-categorized filenames untouched', () => {
    expect(categorizeFilename('dataset/images/item-1.png')).toBe('dataset/images/item-1.png');
    expect(categorizeFilename('legends/symbols/sym-1.png')).toBe('legends/symbols/sym-1.png');
    expect(categorizeFilename('documents/doc-1.pdf')).toBe('documents/doc-1.pdf');
  });

  it('transparently saves into categorized folder and reads back using flat filename', async () => {
    const testDocName = 'test-unit-doc-12345.pdf';
    const content = Buffer.from('PDF_DUMMY_CONTENT');

    await saveFile(testDocName, content);
    expect(await fileExists(testDocName)).toBe(true);

    const read = await getFile(testDocName);
    expect(read.toString()).toBe('PDF_DUMMY_CONTENT');

    await deleteFile(testDocName);
    expect(await fileExists(testDocName)).toBe(false);
  });
});
