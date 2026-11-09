/**
 * YOLO Detection dengan Tiling + Multi-Scale Zoom
 * Untuk komponen kecil dan gambar kompleks
 */
import type { DxfParseResult } from '@/lib/dxf-parser';
import sharp from 'sharp';

interface TiledDetectionOptions {
  tileSize: number;      // 1024 (YOLO input size)
  overlap: number;       // 0.2 (20% overlap between tiles)
  scales: number[];      // [1.0, 1.5, 2.0] zoom levels
}

interface DetectionResult {
  bbox: { x: number; y: number; w: number; h: number };
  assetType: string;
  confidence: number;
  pidPage: number;
  evidence: string[];
  dxfCoordinates: { x: number; y: number };
  scale?: number;        // zoom level detection occurred at
  tile?: string;         // tile identifier (for debugging)
}

/**
 * Detect via YOLO dengan tiling dan multi-scale
 */
export async function detectViaYOLOTiled(
  parsed: DxfParseResult,
  regions: Array<any>,
  renderFn: Function,
  options: TiledDetectionOptions,
  projectId?: string
): Promise<DetectionResult[]> {
  const allDetections: DetectionResult[] = [];
  
  for (const region of regions) {
    const regionDetections: DetectionResult[] = [];
    
    for (const scale of options.scales) {
      // Render region dengan scale tertentu
      const targetWidth = Math.floor(2400 * scale); // base 2400px
      
      const { png, width, height } = await renderFn(parsed, region, {
        theme: 'light',
        targetWidth,
      });
      
      // Tiling: split image into overlapping tiles
      const tiles = generateTiles(width, height, options.tileSize, options.overlap);
      
      console.log(`[yolo] Region ${region.index + 1} scale ${scale}x: ${tiles.length} tiles`);
      
      for (const tile of tiles) {
        // Extract tile dari full image
        const tilePng = await sharp(png)
          .extract({
            left: tile.x,
            top: tile.y,
            width: tile.w,
            height: tile.h,
          })
          .resize(options.tileSize, options.tileSize, { fit: 'fill' })
          .png()
          .toBuffer();
        
        // Run YOLO inference pada tile
        const tileDetections = await runYOLOInference(
          tilePng, 
          options.tileSize,
          projectId || 'default'
        );
        
        // Map detections back to full image coordinates
        for (const det of tileDetections) {
          // Scale bbox from tile space to full image space
          const fullImageBbox = {
            x: tile.x + (det.bbox.x / options.tileSize) * tile.w,
            y: tile.y + (det.bbox.y / options.tileSize) * tile.h,
            w: (det.bbox.w / options.tileSize) * tile.w,
            h: (det.bbox.h / options.tileSize) * tile.h,
          };
          
          // Scale back from zoomed image to original resolution
          const originalBbox = {
            x: fullImageBbox.x / scale,
            y: fullImageBbox.y / scale,
            w: fullImageBbox.w / scale,
            h: fullImageBbox.h / scale,
          };
          
          // Map pixel coords to DXF world coords
          const dxfCoords = pixelToDxfCoords(
            originalBbox.x + originalBbox.w / 2,
            originalBbox.y + originalBbox.h / 2,
            width / scale,
            height / scale,
            region.extents
          );
          
          regionDetections.push({
            bbox: originalBbox,
            assetType: det.assetType,
            confidence: det.confidence,
            pidPage: region.index + 1,
            evidence: [
              `YOLO detection: ${det.className}`,
              `Confidence: ${det.confidence.toFixed(3)}`,
              `Scale: ${scale}x zoom`,
              `Tile: ${tile.id}`,
              `DXF coords: (${dxfCoords.x.toFixed(2)}, ${dxfCoords.y.toFixed(2)})`,
            ],
            dxfCoordinates: dxfCoords,
            scale,
            tile: tile.id,
          });
        }
      }
    }
    
    // NMS per region: remove duplicate detections across scales/tiles
    const nmsDetections = applyNMS(regionDetections, 0.5); // IoU threshold 0.5
    allDetections.push(...nmsDetections);
  }
  
  return allDetections;
}

/**
 * Generate overlapping tiles dari large image
 */
function generateTiles(
  width: number,
  height: number,
  tileSize: number,
  overlap: number
): Array<{ id: string; x: number; y: number; w: number; h: number }> {
  const tiles: Array<any> = [];
  const stride = Math.floor(tileSize * (1 - overlap));
  
  let tileIndex = 0;
  
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const tileW = Math.min(tileSize, width - x);
      const tileH = Math.min(tileSize, height - y);
      
      // Skip tiles yang terlalu kecil
      if (tileW < tileSize * 0.5 || tileH < tileSize * 0.5) continue;
      
      tiles.push({
        id: `tile_${tileIndex}`,
        x,
        y,
        w: tileW,
        h: tileH,
      });
      
      tileIndex++;
    }
  }
  
  return tiles;
}

/**
 * Run YOLO inference via Python FastAPI service
 */
async function runYOLOInference(
  image: Buffer,
  size: number,
  projectId: string = 'default'
): Promise<Array<{ bbox: any; assetType: string; confidence: number; className: string }>> {
  try {
    const base64Image = image.toString('base64');
    
    const response = await fetch('http://127.0.0.1:8765/yolo-detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: base64Image,
        project_id: projectId,
        conf_threshold: 0.25,
        use_pgvector: true,
        use_ocr: true,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('[yolo] Python service error:', error);
      return [];
    }
    
    const result = await response.json();
    
    // Convert Python response ke TypeScript format
    return result.detections.map((det: any) => ({
      bbox: {
        x: det.bbox.x,
        y: det.bbox.y,
        w: det.bbox.width,
        h: det.bbox.height,
      },
      assetType: det.label,
      confidence: det.confidence,
      className: det.source === 'pgvector' ? det.original_yolo_class : det.label,
    }));
    
  } catch (error) {
    console.error('[yolo] Inference error:', error);
    return [];
  }
}

/**
 * Apply NMS (Non-Maximum Suppression) untuk remove duplicates
 */
function applyNMS(detections: DetectionResult[], iouThreshold: number): DetectionResult[] {
  if (detections.length === 0) return [];
  
  // Sort by confidence descending
  const sorted = detections.slice().sort((a, b) => b.confidence - a.confidence);
  const keep: DetectionResult[] = [];
  
  while (sorted.length > 0) {
    const current = sorted.shift()!;
    keep.push(current);
    
    // Remove overlapping detections
    const remaining = sorted.filter(det => {
      const iou = computeIoU(current.bbox, det.bbox);
      return iou < iouThreshold;
    });
    
    sorted.length = 0;
    sorted.push(...remaining);
  }
  
  return keep;
}

/**
 * Compute Intersection over Union
 */
function computeIoU(
  boxA: { x: number; y: number; w: number; h: number },
  boxB: { x: number; y: number; w: number; h: number }
): number {
  const xA = Math.max(boxA.x, boxB.x);
  const yA = Math.max(boxA.y, boxB.y);
  const xB = Math.min(boxA.x + boxA.w, boxB.x + boxB.w);
  const yB = Math.min(boxA.y + boxA.h, boxB.y + boxB.h);
  
  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const boxAArea = boxA.w * boxA.h;
  const boxBArea = boxB.w * boxB.h;
  const unionArea = boxAArea + boxBArea - interArea;
  
  return unionArea === 0 ? 0 : interArea / unionArea;
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
