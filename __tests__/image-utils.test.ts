import { optimizeImageForVision } from '@/lib/ai-providers/image-utils';
import sharp from 'sharp';

describe('optimizeImageForVision', () => {
  it('returns small images untouched', async () => {
    // 10x10 small PNG
    const smallPng = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const base64 = smallPng.toString('base64');
    const res = await optimizeImageForVision(base64, 'image/png');
    expect(res.base64).toBe(base64);
    expect(res.mimeType).toBe('image/png');
  });

  it('optimizes and compresses large images that exceed the byte limit', async () => {
    // Create an artificial image that exceeds threshold
    const raw = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const base64 = raw.toString('base64');
    // Set threshold low (e.g. 20KB) to test triggering the optimization
    const res = await optimizeImageForVision(base64, 'image/png', 20 * 1024);

    expect(res.mimeType).toBe('image/jpeg');
    const optimizedBuf = Buffer.from(res.base64, 'base64');
    expect(optimizedBuf.length).toBeLessThan(raw.length);

    // Verify optimized image is valid sharp image and within max dimension 2400
    const meta = await sharp(optimizedBuf).metadata();
    expect(meta.width).toBeLessThanOrEqual(2400);
    expect(meta.height).toBeLessThanOrEqual(2400);
  }, 15000);
});
