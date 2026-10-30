import sharp from 'sharp';

/**
 * Ensures an image sent to Vision AI providers never exceeds their maximum payload limits
 * (e.g. Anthropic/Bedrock has a strict 5 MB = 5,242,880 bytes limit).
 * 
 * If the image is already below maxBytes (default 4.2 MB), it is returned untouched.
 * If it exceeds maxBytes, it is resized to a max dimension of 2400px and compressed
 * to high-quality JPEG (85%), preserving technical drawing clarity while reducing size dramatically.
 */
export async function optimizeImageForVision(
  base64: string,
  inputMime: string = 'image/png',
  maxBytes: number = 4.2 * 1024 * 1024,
): Promise<{ base64: string; mimeType: string }> {
  if (!base64) {
    return { base64, mimeType: inputMime };
  }

  // Quick estimation: base64 characters * 3 / 4 ≈ decoded byte length
  const estimatedBytes = Math.ceil((base64.length * 3) / 4);
  if (estimatedBytes <= maxBytes) {
    return { base64, mimeType: inputMime };
  }

  try {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length <= maxBytes) {
      return { base64, mimeType: inputMime };
    }

    const meta = await sharp(buf).metadata();
    const width = meta.width ?? 2000;
    const height = meta.height ?? 2000;
    const maxDim = Math.max(width, height);

    let pipeline = sharp(buf);
    // Downscale if image resolution is massive (> 2400px)
    if (maxDim > 2400) {
      pipeline = pipeline.resize({
        width: width >= height ? 2400 : undefined,
        height: height > width ? 2400 : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Convert to JPEG at quality 85: gives ~5-10x compression over PNG with pristine line fidelity
    let optimized = await pipeline.jpeg({ quality: 85, chromaSubsampling: '4:4:4' }).toBuffer();

    // If still over budget in extreme cases, drop to quality 75 and 2000px
    if (optimized.length > maxBytes) {
      optimized = await sharp(buf)
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
    }

    console.log(
      `[image-utils] Optimized image for vision provider: ${(buf.length / 1024 / 1024).toFixed(2)} MB -> ${(optimized.length / 1024 / 1024).toFixed(2)} MB`,
    );

    return {
      base64: optimized.toString('base64'),
      mimeType: 'image/jpeg',
    };
  } catch (err) {
    console.warn('[image-utils] Image optimization failed, falling back to original:', err);
    return { base64, mimeType: inputMime };
  }
}
