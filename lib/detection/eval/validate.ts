/**
 * Ground-truth dataset validator — offline only.
 *
 * Catches annotation mistakes before they pollute an evaluation run:
 * out-of-range class ids, boxes outside page bounds, duplicate ids,
 * missing images, degenerate boxes.
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { resolveYoloClass, YOLO_CLASS_MAP } from '@/lib/detection/yolo/yolo-class-map';
import type { GroundTruthDataset, GroundTruthPage } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  pageId?: string;
  annotationId?: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  pageCount: number;
  annotationCount: number;
  classCounts: Record<string, number>;
  issues: ValidationIssue[];
  /** Pages below the acceptance-gate requirement. */
  belowMinPages: boolean;
}

const MIN_PAGES = 10;

/** Classes the model genuinely supports (canonical, excluding Not_used). */
export function supportedClassIds(): number[] {
  return Object.values(YOLO_CLASS_MAP)
    .filter((c) => c.isValid && c.isCanonical)
    .map((c) => c.id)
    .sort((a, b) => a - b);
}

export async function validateGroundTruth(
  datasetPath: string,
  minPages = MIN_PAGES,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const classCounts: Record<string, number> = {};

  const absPath = path.resolve(process.cwd(), datasetPath);
  if (!fs.existsSync(absPath)) {
    return {
      ok: false,
      pageCount: 0,
      annotationCount: 0,
      classCounts,
      issues: [{ level: 'error', message: `Dataset file not found: ${absPath}` }],
      belowMinPages: true,
    };
  }

  let dataset: GroundTruthDataset;
  try {
    dataset = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (e) {
    return {
      ok: false,
      pageCount: 0,
      annotationCount: 0,
      classCounts,
      issues: [
        {
          level: 'error',
          message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      belowMinPages: true,
    };
  }

  if (!Array.isArray(dataset.pages)) {
    issues.push({ level: 'error', message: '`pages` must be an array' });
    return { ok: false, pageCount: 0, annotationCount: 0, classCounts, issues, belowMinPages: true };
  }

  const datasetDir = path.dirname(absPath);
  const seenPageIds = new Set<string>();
  let totalAnnotations = 0;

  for (const page of dataset.pages) {
    const pageIssues = await validatePage(page, datasetDir, seenPageIds, classCounts);
    issues.push(...pageIssues);
    totalAnnotations += page.annotations?.length ?? 0;
  }

  if (dataset.pages.length < minPages) {
    issues.push({
      level: 'warning',
      message: `Dataset has ${dataset.pages.length} page(s); acceptance gate requires ≥${minPages}.`,
    });
  }

  // Warn about supported classes with no annotations at all.
  for (const id of supportedClassIds()) {
    if (!classCounts[String(id)]) {
      const info = resolveYoloClass(id);
      issues.push({
        level: 'warning',
        message: `No GT instances for supported class ${id} (${info?.yoloLabel ?? '?'}) — recall for this class cannot be measured.`,
      });
    }
  }

  const errors = issues.filter((i) => i.level === 'error');

  return {
    ok: errors.length === 0,
    pageCount: dataset.pages.length,
    annotationCount: totalAnnotations,
    classCounts,
    issues,
    belowMinPages: dataset.pages.length < minPages,
  };
}

async function validatePage(
  page: GroundTruthPage,
  datasetDir: string,
  seenPageIds: Set<string>,
  classCounts: Record<string, number>,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const pageId = page.pageId ?? '(missing pageId)';

  if (!page.pageId) {
    issues.push({ level: 'error', message: 'Page is missing `pageId`' });
  } else if (seenPageIds.has(page.pageId)) {
    issues.push({ level: 'error', pageId, message: `Duplicate pageId: ${page.pageId}` });
  } else {
    seenPageIds.add(page.pageId);
  }

  if (!page.imagePath) {
    issues.push({ level: 'error', pageId, message: 'Page is missing `imagePath`' });
  } else {
    const imgPath = path.isAbsolute(page.imagePath)
      ? page.imagePath
      : path.resolve(datasetDir, page.imagePath);

    if (!fs.existsSync(imgPath)) {
      issues.push({ level: 'error', pageId, message: `Image not found: ${imgPath}` });
    } else {
      // Cross-check declared dimensions against the real image.
      try {
        const meta = await sharp(fs.readFileSync(imgPath)).metadata();
        if (page.width && meta.width && Math.abs(meta.width - page.width) > 1) {
          issues.push({
            level: 'error',
            pageId,
            message: `Declared width ${page.width} != actual ${meta.width}`,
          });
        }
        if (page.height && meta.height && Math.abs(meta.height - page.height) > 1) {
          issues.push({
            level: 'error',
            pageId,
            message: `Declared height ${page.height} != actual ${meta.height}`,
          });
        }
      } catch (e) {
        issues.push({
          level: 'warning',
          pageId,
          message: `Could not read image metadata: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  if (!Array.isArray(page.annotations)) {
    issues.push({ level: 'error', pageId, message: 'Page is missing `annotations` array' });
    return issues;
  }

  const seenAnnIds = new Set<string>();

  for (const ann of page.annotations) {
    const annId = ann.id ?? '(missing id)';

    if (!ann.id) {
      issues.push({ level: 'error', pageId, message: 'Annotation missing `id`' });
    } else if (seenAnnIds.has(ann.id)) {
      issues.push({ level: 'error', pageId, annotationId: ann.id, message: `Duplicate annotation id: ${ann.id}` });
    } else {
      seenAnnIds.add(ann.id);
    }

    const info = resolveYoloClass(ann.classId);
    if (info === null) {
      issues.push({
        level: 'error',
        pageId,
        annotationId: annId,
        message: `Unsupported or invalid classId ${ann.classId} (must be a canonical supported class other than 0)`,
      });
    } else if (info.id !== ann.classId) {
      // Ground truth must use canonical IDs so per-class metrics are not split
      // across duplicate ONNX labels (5→3, 27→26, 31→28).
      issues.push({
        level: 'error',
        pageId,
        annotationId: annId,
        message: `classId ${ann.classId} is a non-canonical duplicate; use canonical classId ${info.id}.`,
      });
    } else {
      classCounts[String(info.id)] = (classCounts[String(info.id)] ?? 0) + 1;
    }

    const b = ann.bbox;
    if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.width !== 'number' || typeof b.height !== 'number') {
      issues.push({
        level: 'error',
        pageId,
        annotationId: annId,
        message: 'bbox must have numeric x, y, width, height',
      });
      continue;
    }

    if (b.width <= 0 || b.height <= 0) {
      issues.push({
        level: 'error',
        pageId,
        annotationId: annId,
        message: `Degenerate bbox (width ${b.width}, height ${b.height})`,
      });
    }

    if (page.width && page.height) {
      if (b.x < 0 || b.y < 0 || b.x + b.width > page.width + 1 || b.y + b.height > page.height + 1) {
        issues.push({
          level: 'error',
          pageId,
          annotationId: annId,
          message: `bbox (${b.x},${b.y},${b.width}x${b.height}) exceeds page bounds ${page.width}x${page.height}`,
        });
      }
    }

    if (b.width > page.width * 0.5 || b.height > page.height * 0.5) {
      issues.push({
        level: 'warning',
        pageId,
        annotationId: annId,
        message: `bbox covers >50% of page dimension — likely too loose for a symbol`,
      });
    }
  }

  return issues;
}
