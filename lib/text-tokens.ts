import db from "@/lib/db";
import { getFile } from "@/lib/storage";
import { extractPdfTextTokensFromBuffer } from "@/lib/spatial-piping";
import { parseDxf, splitDxfRegions, type DxfTextEntity } from "@/lib/dxf-parser";

export interface TextToken {
  text: string;
  x: number; y: number; w: number; h: number; // 0-1000 normalized (top-down y)
}

/** User asked: read every text on the P&ID component drawings except "e tiket". */
const EXCLUDE_TEXT = /e\s*tiket/i;

export async function getDocumentTextTokens(documentId: string, pageNumber: number): Promise<TextToken[]> {
  const doc = (await db.query("SELECT * FROM documents WHERE id=$1", [documentId])).rows[0];
  if (!doc) return [];
  const buf = (await getFile(doc.file_path)) as Buffer;

  if (doc.file_type === 'dxf') {
    const parsed = parseDxf(buf);
    const regions = splitDxfRegions(parsed);
    const region = regions.find((r) => r.index + 1 === pageNumber) ?? regions[0];
    if (!region) return [];
    const { minX, minY, maxX, maxY } = region.extents;
    const width = maxX - minX || 1;
    const height = maxY - minY || 1;

    return region.entities
      .filter((e): e is DxfTextEntity =>
        (e.kind === 'TEXT' || e.kind === 'MTEXT') && !EXCLUDE_TEXT.test(e.text)
      )
      .map((e) => ({
        text: e.text,
        x: ((e.position.x - minX) / width) * 1000,
        y: ((maxY - e.position.y) / height) * 1000,
        w: 40, h: 18,
      }));
  }

  // PDF
  const pageDims = (await db.query(
    "SELECT width, height FROM document_pages WHERE document_id=$1 AND page_number=$2",
    [documentId, pageNumber],
  )).rows[0] ?? { width: 1000, height: 1000 };
  const tokens = await extractPdfTextTokensFromBuffer(buf, pageNumber);
  return tokens
    .filter((t) => !EXCLUDE_TEXT.test(t.text))
    .map((t) => ({
      text: t.text,
      x: (t.bbox.x / pageDims.width) * 1000,
      y: (t.bbox.y / pageDims.height) * 1000,
      w: (t.bbox.width / pageDims.width) * 1000,
      h: (t.bbox.height / pageDims.height) * 1000,
    }));
}
