/**
 * OpenCV Template Matching dari approved crops di storage/
 * Gunakan approved detection crops sebagai template
 */
import type { DxfParseResult } from '@/lib/dxf-parser';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

interface DetectionResult {
  bbox: { x: number; y: number; w: number; h: number };
  assetType: string;
  confidence: number;
  pidPage: number;
  evidence: string[];
  dxfCoordinates: { x: number; y: number };
}

/**
 * Detect via OpenCV template matching
 * Templates = approved detection crops dari storage/dataset/
 */
export async function detectViaOpenCVTemplates(
  parsed: DxfParseResult,
  regions: Array<any>,
  projectId: string | null,
  renderFn: Function
): Promise<DetectionResult[]> {
  const detections: DetectionResult[] = [];
  
  try {
    // Load approved templates dari storage
    const templates = await loadApprovedTemplates(projectId);
    
    if (templates.length === 0) {
      console.log('[opencv] No approved templates found');
      return detections;
    }
    
    console.log(`[opencv] Loaded ${templates.length} templates`);
    
    // Render each region untuk template matching
    for (const region of regions) {
      const { png, width, height } = await renderFn(parsed, region, {
        theme: 'light',
        targetWidth: 2400,
      });
      
      // Template matching untuk setiap template
      for (const template of templates) {
        const matches = await templateMatch(png, template.image, {
          threshold: 0.8, // minimum similarity
          method: 'TM_CCOEFF_NORMED', // OpenCV method
        });
        
        for (const match of matches) {
          // Map pixel coordinates back to DXF coordinates
          const dxfCoords = pixelToDxfCoords(
            match.x,
            match.y,
            width,
            height,
            region.extents
          );
          
          detections.push({
            bbox: {
              x: match.x,
              y: match.y,
              w: template.width,
              h: template.height,
            },
            assetType: template.assetType,
            confidence: match.confidence,
            pidPage: region.index + 1,
            evidence: [
              `OpenCV template match: ${template.name}`,
              `Confidence: ${match.confidence.toFixed(3)}`,
              `Method: ${template.method || 'TM_CCOEFF_NORMED'}`,
              `Template: ${template.path}`,
            ],
            dxfCoordinates: dxfCoords,
          });
        }
      }
    }
  } catch (err) {
    console.error('[opencv] Error:', err);
  }
  
  return detections;
}

/**
 * Load approved detection templates dari storage/
 */
async function loadApprovedTemplates(projectId: string | null): Promise<Array<any>> {
  const templates: Array<any> = [];
  
  // Path: storage/dataset/approved/ (dari confirmed detections)
  const approvedDir = path.resolve(process.cwd(), 'storage', 'dataset', 'approved');
  
  if (!fs.existsSync(approvedDir)) {
    console.log('[opencv] Approved dir not found:', approvedDir);
    return templates;
  }
  
  const files = fs.readdirSync(approvedDir)
    .filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
  
  for (const file of files) {
    const fullPath = path.join(approvedDir, file);
    const meta = parseTemplateFilename(file);
    
    if (!meta) continue;
    
    // Load image
    const image = await sharp(fullPath).raw().toBuffer();
    const metadata = await sharp(fullPath).metadata();
    
    templates.push({
      name: meta.assetType,
      assetType: meta.assetType,
      image,
      width: metadata.width || 50,
      height: metadata.height || 50,
      path: fullPath,
    });
  }
  
  return templates;
}

/**
 * Parse template filename: P-101_Pump_conf0.92.png → { assetType: 'Pump', tag: 'P-101', conf: 0.92 }
 */
function parseTemplateFilename(filename: string): { assetType: string; tag?: string; conf?: number } | null {
  // Expected format: [tag]_[type]_conf[score].png
  const match = filename.match(/^([^_]+)?_([^_]+)_conf([\d.]+)\.png$/);
  if (!match) return null;
  
  return {
    tag: match[1] || undefined,
    assetType: match[2],
    conf: parseFloat(match[3]),
  };
}

/**
 * Template matching menggunakan OpenCV (via Python service)
 */
async function templateMatch(
  image: Buffer,
  template: Buffer,
  options: { threshold: number; method: string }
): Promise<Array<{ x: number; y: number; confidence: number }>> {
  // TODO: Call Python CV service `/template-match` endpoint
  // For now, return empty (placeholder)
  
  // Expected Python endpoint:
  // POST http://localhost:8765/template-match
  // Body: { image: base64, template: base64, threshold: 0.8, method: 'TM_CCOEFF_NORMED' }
  // Response: { matches: [{ x, y, confidence }] }
  
  return [];
}

/**
 * Convert pixel coordinates to DXF world coordinates
 */
function pixelToDxfCoords(
  pixelX: number,
  pixelY: number,
  imageWidth: number,
  imageHeight: number,
  extents: { minX: number; minY: number; maxX: number; maxY: number }
): { x: number; y: number } {
  // Map pixel space [0, imageWidth] → DXF space [minX, maxX]
  const dxfX = extents.minX + (pixelX / imageWidth) * (extents.maxX - extents.minX);
  const dxfY = extents.maxY - (pixelY / imageHeight) * (extents.maxY - extents.minY); // flip Y
  
  return { x: dxfX, y: dxfY };
}
