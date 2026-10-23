import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

export async function extractTextFromRegion(imageBuffer: Buffer, bbox: { left: number, top: number, width: number, height: number }): Promise<string> {
  // Preprocess: crop and thresholding for better OCR
  const processed = await sharp(imageBuffer)
    .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
    .greyscale()
    .threshold(128)
    .toBuffer();

  const worker = await createWorker('eng');
  const { data: { text } } = await worker.recognize(processed);
  await worker.terminate();
  
  return text.trim();
}
