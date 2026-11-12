/**
 * Legend-Based Detection menggunakan pgvector similarity search
 * Cari approved legend symbols dari storage/legends/symbols/
 */
import type { DxfParseResult } from '@/lib/dxf-parser';
import db from '@/lib/db';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

interface DetectionResult {
  bbox: { x: number; y: number; w: number; h: number };
  assetType: string;
  confidence: number;
  pidPage: number;
  evidence: string[];
  dxfCoordinates: { x: number; y: number }; // koordinat asli dari DXF
}

/**
 * Detect symbols via legend embedding similarity (pgvector)
 */
export async function detectViaLegendEmbeddings(
  parsed: DxfParseResult,
  regions: Array<any>,
  projectId: string | null,
  legendSymbols: Array<any>
): Promise<DetectionResult[]> {
  const detections: DetectionResult[] = [];
  
  try {
    // Query approved legend symbols dengan embeddings
    const symbolsRes = await db.query(`
      SELECT 
        ls.id, ls.legend_id, ls.symbol_name, ls.asset_type,
        ls.bbox_x, ls.bbox_y, ls.bbox_w, ls.bbox_h,
        se.embedding, se.canonical_features
      FROM legend_symbols ls
      LEFT JOIN symbol_embeddings se ON se.asset_type = ls.asset_type 
        AND (se.project_id = $1 OR se.project_id IS NULL)
      WHERE ls.quality_status = 'VALID'
        AND se.embedding IS NOT NULL
      ORDER BY se.confirmed_count DESC
      LIMIT 100
    `, [projectId]);
    
    if (symbolsRes.rows.length === 0) {
      return detections;
    }
    
    // Extract candidate regions dari DXF (blocks, circles, polylines)
    const candidates = extractCandidateRegions(parsed);
    
    for (const candidate of candidates) {
      // Render candidate region ke crop image
      const candidateCrop = await renderCandidateToCrop(parsed, candidate);
      
      // Generate embedding untuk candidate (via AI atau feature extraction)
      const candidateEmbedding = await generateEmbedding(candidateCrop);
      
      // Cosine similarity search via pgvector
      const matchRes = await db.query(`
        SELECT 
          ls.id, ls.legend_id, ls.symbol_name, ls.asset_type,
          1 - (se.embedding <=> $1::vector) AS similarity
        FROM symbol_embeddings se
        JOIN legend_symbols ls ON ls.asset_type = se.asset_type
        WHERE (se.project_id = $2 OR se.project_id IS NULL)
          AND 1 - (se.embedding <=> $1::vector) > 0.85
        ORDER BY similarity DESC
        LIMIT 1
      `, [JSON.stringify(candidateEmbedding), projectId]);
      
      if (matchRes.rows.length > 0) {
        const match = matchRes.rows[0];
        detections.push({
          bbox: candidate.bbox,
          assetType: match.asset_type,
          confidence: match.similarity,
          pidPage: candidate.pidPage,
          evidence: [
            `Legend match: ${match.symbol_name}`,
            `Similarity: ${match.similarity.toFixed(3)}`,
            `Source: pgvector embedding search`,
            `Reference: ${match.crop_path}`,
          ],
          dxfCoordinates: candidate.dxfCoords,
        });
      }
    }
  } catch (err) {
    console.error('[legend-detection] Error:', err);
  }
  
  return detections;
}

/**
 * Extract candidate regions dari DXF entities
 */
function extractCandidateRegions(parsed: DxfParseResult): Array<any> {
  const candidates = [];
  
  // Group entities by spatial proximity (candidates untuk symbol)
  const blocks = parsed.entities.filter((e: any) => 
    e.type === 'INSERT' || 
    e.type === 'CIRCLE' || 
    e.type === 'LWPOLYLINE' && e.closed
  );
  
  for (const block of blocks) {
    // Calculate bbox dari entity coordinates
    const bbox = calculateEntityBbox(block);
    const dxfCoords = { x: (block as any).x || 0, y: (block as any).y || 0 };
    
    candidates.push({
      entity: block,
      bbox,
      dxfCoords,
      pidPage: 1, // TODO: map to actual page from regions
    });
  }
  
  return candidates;
}

/**
 * Calculate bbox dari DXF entity coordinates
 */
function calculateEntityBbox(entity: any): { x: number; y: number; w: number; h: number } {
  if (entity.type === 'CIRCLE') {
    const r = entity.radius || 10;
    return {
      x: (entity.x || 0) - r,
      y: (entity.y || 0) - r,
      w: r * 2,
      h: r * 2,
    };
  }
  
  if (entity.type === 'INSERT') {
    // Approximate bbox dari block reference
    const w = 50; // default width
    const h = 50;
    return {
      x: entity.x || 0,
      y: entity.y || 0,
      w,
      h,
    };
  }
  
  // Fallback
  return { x: 0, y: 0, w: 50, h: 50 };
}

/**
 * Render candidate region ke crop image (placeholder)
 */
async function renderCandidateToCrop(
  parsed: DxfParseResult,
  candidate: any
): Promise<Buffer> {
  // TODO: implement actual DXF → PNG crop rendering
  // For now, return dummy buffer
  return Buffer.from('placeholder');
}

/**
 * Generate embedding untuk candidate crop (placeholder)
 */
async function generateEmbedding(crop: Buffer): Promise<number[]> {
  const CV_SERVICE_URL = process.env.CV_SERVICE_URL || 'http://localhost:8765';
  
  try {
    const imageB64 = crop.toString('base64');
    
    const response = await fetch(`${CV_SERVICE_URL}/embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: imageB64 }),
    });
    
    if (!response.ok) {
      throw new Error(`Embedding API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.warning) {
      console.warn(`[legend-detector] ${data.warning}`);
    }
    
    return data.embedding as number[];
  } catch (error) {
    console.error('[legend-detector] Failed to generate embedding:', error);
    // Fallback: return zero vector
    return new Array(768).fill(0);
  }
}
