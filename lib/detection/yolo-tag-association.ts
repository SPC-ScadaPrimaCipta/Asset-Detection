/**
 * OCR Tag Association for YOLO Detections
 * 
 * Associates TEXT entities (tags) with YOLO-detected symbol bboxes using:
 * - Spatial proximity (adaptive radius based on symbol size)
 * - Multi-line text merging (PSH + P-0201 → PSH-P-0201)
 * - Tag pattern validation against legend
 */

import type { DxfTextEntity, DxfParseResult } from '@/lib/dxf-parser';

export interface TagCandidate {
  text: string;
  distance: number;
  position: { x: number; y: number };
  entity: DxfTextEntity;
}

export interface YoloBbox {
  x: number;  // 0-1000 normalized
  y: number;
  width: number;
  height: number;
}

export interface TagAssociationResult {
  tag: string | null;
  confidence: number;  // 0-1
  evidence: string[];
  candidates: TagCandidate[];
}

/**
 * Find nearest TEXT entities to a YOLO detection bbox.
 * 
 * Search strategy:
 * 1. Extract all TEXT entities from DXF within search radius
 * 2. Calculate distance from bbox center to text position
 * 3. Rank by proximity
 * 4. Filter by tag pattern validation (if legend patterns available)
 * 
 * @param yoloBbox YOLO detection bounding box (0-1000 normalized space)
 * @param dxfParsed Parsed DXF data with world coordinates
 * @param regionExtents Region extents for coordinate conversion
 * @param tagPatterns Optional regex patterns from legend for validation
 * @param searchRadiusMultiplier Adaptive radius = symbol width × multiplier (default: 2.0)
 */
export function findNearestTag(
  yoloBbox: YoloBbox,
  dxfParsed: DxfParseResult,
  regionExtents: { minX: number; minY: number; maxY: number; width: number; height: number },
  tagPatterns?: RegExp[],
  searchRadiusMultiplier: number = 2.0
): TagAssociationResult {
  const evidence: string[] = [];
  
  // Convert YOLO normalized bbox to world coordinates
  const worldCenterX = regionExtents.minX + (yoloBbox.x + yoloBbox.width / 2) / 1000 * regionExtents.width;
  const worldCenterY = regionExtents.maxY - (yoloBbox.y + yoloBbox.height / 2) / 1000 * regionExtents.height;
  const worldWidth = (yoloBbox.width / 1000) * regionExtents.width;
  
  // Adaptive search radius based on symbol size
  const searchRadius = worldWidth * searchRadiusMultiplier;
  
  evidence.push(`Search radius: ${searchRadius.toFixed(1)} (symbol width × ${searchRadiusMultiplier})`);
  
  // Extract TEXT entities
  const textEntities: DxfTextEntity[] = dxfParsed.entities
    .filter((e: any) => e.type === 'TEXT' || e.type === 'MTEXT')
    .map((e: any) => e as DxfTextEntity);
  
  if (textEntities.length === 0) {
    evidence.push('No TEXT entities found in DXF');
    return { tag: null, confidence: 0, evidence, candidates: [] };
  }
  
  // Merge multi-line text stacks (PSH + P-0201 → PSH-P-0201)
  const mergedTexts = mergeVerticalTextStack(textEntities);
  
  // Find candidates within search radius
  const candidates: TagCandidate[] = [];
  
  for (const textEnt of mergedTexts) {
    const dx = textEnt.position.x - worldCenterX;
    const dy = textEnt.position.y - worldCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance <= searchRadius) {
      candidates.push({
        text: textEnt.text.trim(),
        distance,
        position: textEnt.position,
        entity: textEnt,
      });
    }
  }
  
  // Sort by distance (nearest first)
  candidates.sort((a, b) => a.distance - b.distance);
  
  evidence.push(`Found ${candidates.length} text candidates within radius`);
  
  if (candidates.length === 0) {
    evidence.push('No TEXT entities within search radius');
    return { tag: null, confidence: 0, evidence, candidates: [] };
  }
  
  // Validate against tag patterns (if provided)
  let validatedTag: string | null = null;
  let validatedConfidence = 0;
  
  if (tagPatterns && tagPatterns.length > 0) {
    for (const candidate of candidates) {
      const text = candidate.text.toUpperCase();
      
      for (const pattern of tagPatterns) {
        if (pattern.test(text)) {
          validatedTag = text;
          // Confidence decreases with distance (inverse distance weighting)
          validatedConfidence = Math.max(0.6, 1.0 - (candidate.distance / searchRadius) * 0.4);
          evidence.push(`Tag validated: "${text}" matches pattern ${pattern.source}`);
          evidence.push(`Distance: ${candidate.distance.toFixed(1)} → confidence ${validatedConfidence.toFixed(3)}`);
          return { tag: validatedTag, confidence: validatedConfidence, evidence, candidates };
        }
      }
    }
    
    evidence.push('No candidates matched legend tag patterns');
  }
  
  // Fallback: use nearest text if no pattern validation
  const nearest = candidates[0];
  validatedTag = nearest.text.toUpperCase();
  validatedConfidence = Math.max(0.4, 1.0 - (nearest.distance / searchRadius) * 0.5);
  
  evidence.push(`Nearest text (no pattern validation): "${validatedTag}"`);
  evidence.push(`Distance: ${nearest.distance.toFixed(1)} → confidence ${validatedConfidence.toFixed(3)}`);
  
  return {
    tag: validatedTag,
    confidence: validatedConfidence,
    evidence,
    candidates: candidates.slice(0, 5), // Keep top 5 for debugging
  };
}

/**
 * Merge vertically stacked TEXT entities into single tag.
 * Example: PSH (line 1) + P-0201 (line 2) → PSH-P-0201
 * 
 * Internal helper - simplified version of dxf-detection.ts implementation.
 */
function mergeVerticalTextStack(texts: DxfTextEntity[]): DxfTextEntity[] {
  if (texts.length === 0) return [];
  
  // Calculate median text height for tolerance
  const heights = texts.map(t => t.height || 10).filter(h => h > 0);
  heights.sort((a, b) => a - b);
  const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 10;
  
  const vTol = medianHeight * 1.5;  // Vertical tolerance
  const hTol = medianHeight * 0.3;  // Horizontal alignment tolerance
  
  const consumed = new Set<DxfTextEntity>();
  const result: DxfTextEntity[] = [];
  
  // Sort by layer then Y-descending (top to bottom)
  const sorted = [...texts].sort((a, b) => {
    if (a.layer !== b.layer) return a.layer.localeCompare(b.layer);
    return b.position.y - a.position.y;
  });
  
  for (let i = 0; i < sorted.length; i++) {
    if (consumed.has(sorted[i])) continue;
    
    const top = sorted[i];
    const stacked = [top];
    consumed.add(top);
    
    // Look for texts below this one
    for (let j = i + 1; j < sorted.length; j++) {
      const below = sorted[j];
      if (consumed.has(below) || below.layer !== top.layer) continue;
      
      const last = stacked[stacked.length - 1];
      const vDist = Math.abs(last.position.y - below.position.y);
      const hDist = Math.abs(last.position.x - below.position.x);
      
      if (vDist <= vTol && hDist <= hTol) {
        stacked.push(below);
        consumed.add(below);
      } else if (vDist > vTol * 2) {
        break;
      }
    }
    
    // Merge multi-line
    if (stacked.length > 1) {
      const parts = stacked.map(t => t.text.trim()).filter(Boolean);
      const merged = parts.join(parts.some(p => p.includes('-')) ? '' : '-');
      
      result.push({
        ...top,
        text: merged,
        position: {
          x: stacked.reduce((sum, t) => sum + t.position.x, 0) / stacked.length,
          y: stacked.reduce((sum, t) => sum + t.position.y, 0) / stacked.length,
        },
      });
    } else {
      result.push(top);
    }
  }
  
  return result;
}
