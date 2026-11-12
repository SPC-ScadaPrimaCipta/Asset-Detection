/**
 * OCR Text Extraction untuk tag detection
 * Support EasyOCR dan Tesseract
 */
import type { DxfParseResult } from '@/lib/dxf-parser';
import sharp from 'sharp';

interface OCRText {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  pidPage: number;
  dxfCoordinates: { x: number; y: number };
}

/**
 * Extract OCR texts from rendered DXF regions
 */
export async function extractOCRTexts(
  parsed: DxfParseResult,
  regions: Array<any>,
  renderFn: Function
): Promise<OCRText[]> {
  const allTexts: OCRText[] = [];
  
  for (const region of regions) {
    // Render region high-res untuk OCR
    const { png, width, height } = await renderFn(parsed, region, {
      theme: 'light',
      targetWidth: 3000, // higher res untuk OCR accuracy
    });
    
    // Run OCR via Python service
    const ocrResults = await runOCR(png);
    
    for (const result of ocrResults) {
      // Map pixel coords to DXF coords
      const dxfCoords = pixelToDxfCoords(
        result.bbox.x + result.bbox.w / 2,
        result.bbox.y + result.bbox.h / 2,
        width,
        height,
        region.extents
      );
      
      allTexts.push({
        text: result.text,
        bbox: result.bbox,
        confidence: result.confidence,
        pidPage: region.index + 1,
        dxfCoordinates: dxfCoords,
      });
    }
  }
  
  return allTexts;
}

/**
 * Run OCR via Python CV service
 */
async function runOCR(
  image: Buffer
): Promise<Array<{ text: string; bbox: any; confidence: number }>> {
  // TODO: Call Python CV service `/ocr` endpoint
  // POST http://localhost:8765/ocr
  // Body: { image: base64, lang: 'en' }
  // Response: { texts: [{ text, bbox: {x,y,w,h}, confidence }] }
  
  // Placeholder
  return [];
}

/**
 * Convert pixel to DXF coords
 */
function pixelToDxfCoords(
  pixelX: number,
  pixelY: number,
  imageWidth: number,
  imageHeight: number,
  extents: { minX: number; minY: number; maxX: number; maxY: number }
): { x: number; y: number } {
  const dxfX = extents.minX + (pixelX / imageWidth) * (extents.maxX - extents.minX);
  const dxfY = extents.maxY - (pixelY / imageHeight) * (extents.maxY - extents.minY);
  
  return { x: dxfX, y: dxfY };
}
