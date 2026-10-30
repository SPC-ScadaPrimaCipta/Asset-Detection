/**
 * Spatial Piping Line & Size Association
 *
 * Connects detected equipment symbols (e.g., valves) with nearby piping line labels
 * extracted from OCR text or vector text tokens on P&ID drawings.
 */

import { parseLineSpecText, extractSizeFromLineSpec } from '@/lib/piping-parser';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextToken {
  text: string;
  bbox: BoundingBox;
}

export interface PipingCandidate {
  rawText: string;
  size: string;
  service?: string;
  spec?: string;
  bbox: BoundingBox;
}

export interface PipingSizeMatch {
  size: string;
  lineText: string;
  distance: number;
}

/**
 * Filter and extract piping line candidates from raw text tokens.
 */
export function extractPipingCandidatesFromTokens(tokens: TextToken[]): PipingCandidate[] {
  const candidates: PipingCandidate[] = [];
  for (const t of tokens) {
    const parsed = parseLineSpecText(t.text);
    if (!parsed) continue;
    candidates.push({
      rawText: parsed.rawText,
      size: parsed.pipeSize,
      service: parsed.service,
      spec: parsed.spec,
      bbox: t.bbox,
    });
  }
  return candidates;
}

function centerOf(b: BoundingBox): { x: number; y: number } {
  return {
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
  };
}

function distance(c1: { x: number; y: number }, c2: { x: number; y: number }): number {
  const dx = c1.x - c2.x;
  const dy = c1.y - c2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Associates the nearest piping line label to a target bounding box (e.g. valve).
 * Checks directional proximity and distance threshold.
 */
export function associateNearestPipingSize(
  targetBbox: BoundingBox,
  tokensOrCandidates: TextToken[] | PipingCandidate[],
  maxDistance: number = 300
): PipingSizeMatch | null {
  if (!tokensOrCandidates || tokensOrCandidates.length === 0) return null;

  // Normalize to PipingCandidate
  const candidates: PipingCandidate[] =
    tokensOrCandidates.length > 0 && 'size' in tokensOrCandidates[0]
      ? (tokensOrCandidates as PipingCandidate[])
      : extractPipingCandidatesFromTokens(tokensOrCandidates as TextToken[]);

  if (candidates.length === 0) return null;

  const targetCenter = centerOf(targetBbox);
  let bestCandidate: PipingCandidate | null = null;
  let minD = maxDistance;

  for (const c of candidates) {
    const cCenter = centerOf(c.bbox);
    const d = distance(targetCenter, cCenter);
    if (d < minD) {
      minD = d;
      bestCandidate = c;
    }
  }

  if (!bestCandidate) return null;

  return {
    size: bestCandidate.size,
    lineText: bestCandidate.rawText,
    distance: minD,
  };
}

/**
 * Extract text tokens with bounding boxes directly from a PDF buffer page using MuPDF in-process.
 */
export async function extractPdfTextTokensFromBuffer(
  buffer: Buffer,
  pageNumber: number
): Promise<TextToken[]> {
  try {
    const mupdf = await import("mupdf" as string);
    const { Document } = mupdf;
    const doc = Document.openDocument(buffer, "application/pdf");
    const pageCount = doc.countPages();
    if (pageNumber < 1 || pageNumber > pageCount) return [];

    const page = doc.loadPage(pageNumber - 1);
    const st = page.toStructuredText();
    const jsonStr = st.asJSON();
    const data = JSON.parse(jsonStr) as {
      blocks?: Array<{
        type?: string;
        bbox?: { x: number; y: number; w: number; h: number };
        lines?: Array<{
          bbox?: { x: number; y: number; w: number; h: number };
          text?: string;
        }>;
      }>;
    };

    const tokens: TextToken[] = [];
    if (data.blocks) {
      for (const block of data.blocks) {
        if (block.lines) {
          for (const line of block.lines) {
            const txt = line.text?.trim();
            if (!txt) continue;
            const b = line.bbox || block.bbox || { x: 0, y: 0, w: 0, h: 0 };
            tokens.push({
              text: txt,
              bbox: {
                x: b.x,
                y: b.y,
                width: b.w,
                height: b.h,
              },
            });
          }
        }
      }
    }
    return tokens;
  } catch {
    return [];
  }
}

