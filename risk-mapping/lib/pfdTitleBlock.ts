import path from 'path';

export interface TitleBlock {
    doc_number: string | null;
    revision: string | null; // Manual entry only (auto-detection intentionally disabled)
    title: string | null;
    project: string | null;
    company: string | null;
    job_no: string | null;
    discipline?: string | null;
    detected: boolean;
}

export interface PageTitleBlock extends TitleBlock {
    page: number;
}

export interface MultiPageTitleBlockResult {
    pages: PageTitleBlock[];
    is_multi_drawing: boolean;
    primary: TitleBlock;
    title_detected: boolean;
}

// Convert all-caps string to Title Case nicely (e.g. "SCRUBBING PIPELINE" -> "Scrubbing Pipeline")
export function toTitleCase(str: string): string {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map((word) => {
            if (!word) return '';
            const leadingPunct = word.match(/^[(\["']+/)?.[0] || '';
            const coreWord = word.slice(leadingPunct.length);
            if (!coreWord) return word;

            const upper = coreWord.toUpperCase();
            if (['P&ID', 'PFD', 'EDG', 'ACW', 'IA', 'FW', 'U3', 'WW3', 'SBS1', 'AFT', 'MOV', 'PCV', 'LCV', 'PT', 'IKPT'].includes(upper)) {
                return leadingPunct + upper;
            }
            if (['and', 'for', 'of', 'the', 'in', 'on', 'at', 'to', '&', 'by'].includes(coreWord.toLowerCase())) {
                return leadingPunct + coreWord.toLowerCase();
            }
            return leadingPunct + (coreWord.charAt(0).toUpperCase() + coreWord.slice(1));
        })
        .join(' ')
        .trim();
}

/**
 * Two separate regex families to classify drawing pages vs. document/cover pages.
 * Family 1: Pipe line tags (covers standard, compact, fractional line numbers, e.g. 20"-S1-61-3001-TH, 3/4"-A3-95-3009)
 * Family 2: Instrument & equipment tags (e.g. V-101, FT-201A, TI-301, VS-95-3001, AD-300A/B)
 */
const PIPE_TAG_RE = /\b\d+(?:\.\d+)?(?:\/\d+)?"-[A-Z]\d-(?:\d{2}-\d{4}|\d[A-Z]{2,3}\d{3})(?:-[A-Z]{2,3})?\b/g;
const INSTRUMENT_TAG_RE = /\b(?<!-)[A-Z]{1,4}-\d{2,4}(?:-\d{2,4})?[A-Z]?(?:\/[A-Z])?(?!-)\b/g;

/**
 * Counts engineering tags on a given page text to determine if it is an actual drawing sheet
 * (typically tens to hundreds of tags) or a cover/doc sheet (usually <= 3 tags).
 */
export function countDrawingTags(text: string): number {
    if (!text || typeof text !== 'string') return 0;
    const pipeTags = (text.match(PIPE_TAG_RE) || []).length;
    const instrTags = (text.match(INSTRUMENT_TAG_RE) || []).length;
    return pipeTags + instrTags;
}

/**
 * Detects the most likely drawing sheet page number from extracted page texts.
 * Uses countDrawingTags to find the page with maximum engineering tag density (> 3 tags).
 * Falls back to scanning for P&ID / PFD / FLOW DIAGRAM keywords on non-comment pages,
 * or returns 1.
 */
export function detectDrawingDefaultPage(
    pageTexts: { page?: number; page_no?: number; text?: string | null }[]
): number {
    if (!pageTexts || pageTexts.length <= 1) return 1;

    let bestPage = 1;
    let maxTags = 0;

    for (let i = 0; i < pageTexts.length; i++) {
        const pt = pageTexts[i];
        const pageNum = pt.page ?? pt.page_no ?? i + 1;
        const tags = countDrawingTags(pt.text || '');
        if (tags > maxTags) {
            maxTags = tags;
            bestPage = pageNum;
        }
    }

    // If tag density found a drawing sheet (> 3 tags), that's our winner
    if (maxTags > 3) {
        return bestPage;
    }

    // Fallback: Check for drawing sheet title keywords without comment-sheet headers
    for (let i = 0; i < pageTexts.length; i++) {
        const pt = pageTexts[i];
        const text = pt.text || '';
        const pageNum = pt.page ?? pt.page_no ?? i + 1;
        const hasDrawingKeyword = /PIPING AND INSTRUMENTATION DIAGRAM|PROCESS FLOW DIAGRAM|FLOW SHEET|FLOW DIAGRAM/i.test(text);
        const hasCommentHeader = /SEG Comments|IKPT Response|Responded by|Commented by/i.test(text);
        if (hasDrawingKeyword && !hasCommentHeader) {
            return pageNum;
        }
    }

    return 1;
}

/**
 * Extracts title block metadata from the raw text of a page.
 *
 * NOTE ON REVISION:
 * Revision auto-detection is deliberately disabled because revision history tables
 * (listing previous revisions A, B, C, D, E) cause frequent false positives.
 * Revision is left as null so the user can enter the true revision manually in the UI.
 *
 * @param pageText Raw text of the page
 * @param kvOnly If true, only looks for explicit key-value labels (e.g. "Document No. : ...")
 */
export function extractTitleBlock(pageText: string, kvOnly = false): TitleBlock {
    if (!pageText || typeof pageText !== 'string') {
        return {
            doc_number: null,
            revision: null,
            title: null,
            project: null,
            company: null,
            job_no: null,
            discipline: null,
            detected: false,
        };
    }

    const lines = pageText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

    let docNumber: string | null = null;
    const revision: string | null = null; // Auto-detection removed; manual entry only
    let title: string | null = null;
    let project: string | null = null;
    let company: string | null = null;
    let jobNo: string | null = null;
    let discipline: string | null = null;

    // --- 1. Explicit Key-Value Matches (cleanest on document/cover sheets) ---

    // A. Explicit Job No. (e.g. "Job No. : 23246" or "Job No:\n23246")
    const explicitJobMatch = pageText.match(/\b(?:Job|Project)\s*(?:No|Number)\.?\s*[:\.]?\s*([A-Z0-9_-]{3,15})\b/i);
    if (explicitJobMatch) {
        jobNo = explicitJobMatch[1].trim();
    }

    // B. Explicit Discipline (e.g. "Discipline: Process" or "Discipline :\nProcess")
    const explicitDiscMatch = pageText.match(/\bDiscipline\s*[:\.]?\s*([A-Za-z]+)\b/i);
    if (explicitDiscMatch) {
        discipline = toTitleCase(explicitDiscMatch[1].trim());
    }

    // C. Explicit Document Title (e.g. "Document Title : Piping and Instrument Diagram..." or "Document Title\n: ...")
    const explicitTitleMatch = pageText.match(
        /\b(?:Document\s*Title|DWG\s*Title|Drawing\s*Title)\s*[:\.]?\s*([^:\n\r]+?)(?=[ \t]+(?:Discipline|Rev|Job|Sheet|Page|\d{3,}|$)|[\r\n]|$)/i
    );
    if (explicitTitleMatch) {
        const rawTitle = explicitTitleMatch[1].trim();
        if (rawTitle.length > 3 && rawTitle.length < 150) {
            title = toTitleCase(rawTitle);
        }
    }

    // D. Explicit Document Number (e.g. "Document No. : WW3-MP-61-0001" or "Document No.\n: WW3-MP-61-0001")
    const explicitDocMatch = pageText.match(
        /\b(?:Document\s*(?:No|Number)\.?|DWG\s*NO\.?|DRAWING\s*NO\.?)\s*[:\.]?\s*([A-Z0-9]{2,5}-[A-Z0-9]{2,4}-[A-Z0-9_]{2,6}-[A-Z0-9]{3,6}(?:_\d+)?)/i
    );
    if (explicitDocMatch) {
        docNumber = explicitDocMatch[1].toUpperCase();
    }

    // E. Explicit Project (e.g. "PROJECT : <PROJECT NAME>...")
    const explicitProjMatch = pageText.match(/\bPROJECT\s*:\s*([^\n\r]+)/i);
    if (explicitProjMatch) {
        const rawProj = explicitProjMatch[1].trim();
        if (!/NO\.|NUMBER/i.test(rawProj) && rawProj.length > 4 && rawProj.length < 120) {
            project = toTitleCase(rawProj);
        }
    }

    // F. Explicit Contractor / Owner (e.g. "OWNER : <COMPANY NAME>...")
    const explicitOwnerMatch = pageText.match(/\b(?:OWNER|CLIENT)\s*:\s*([^\n\r]+)/i);
    if (explicitOwnerMatch) {
        const rawOwner = explicitOwnerMatch[1].trim();
        if (rawOwner.length > 3 && rawOwner.length < 120) {
            company = toTitleCase(rawOwner);
        }
    }
    const explicitContractorMatch = pageText.match(/\bCONTRACTOR\s*:\s*([^\n\r]+)/i);
    if (explicitContractorMatch && !company) {
        const rawContractor = explicitContractorMatch[1].trim();
        if (rawContractor.length > 3 && rawContractor.length < 120) {
            company = toTitleCase(rawContractor);
        }
    }

    // --- 2. Heuristic Workarounds (only run when kvOnly is false) ---
    if (!kvOnly) {
        // Document Number pattern fallback (e.g. standalone "WW3-MP-61-0001")
        if (!docNumber) {
            const docRegex = /\b(WW\d-[A-Z0-9]{2,4}-[A-Z0-9_]{2,6}-\d{3,5}(?:_\d+)?)\b/i;
            for (const line of lines) {
                const match = line.match(docRegex);
                if (match) {
                    docNumber = match[1].toUpperCase();
                    break;
                }
            }
        }

        // Drawing Title fallback: preceding "PIPING AND INSTRUMENTATION DIAGRAM"
        if (!title) {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (/PIPING AND INSTRUMENTATION DIAGRAM|PROCESS FLOW DIAGRAM|FLOW DIAGRAM/i.test(line)) {
                    const prevLine = i > 0 ? lines[i - 1] : '';
                    if (
                        prevLine &&
                        prevLine.length > 2 &&
                        prevLine.length < 100 &&
                        !/PROJECT|LIMITED|DWG|DRAWING|PAGE|SHEET|CONTRACTOR|OWNER/i.test(prevLine)
                    ) {
                        title = `${toTitleCase(prevLine)} P&ID`;
                    } else {
                        title = toTitleCase(line);
                    }
                    break;
                }
            }
        }

        // Project fallback
        if (!project) {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (/\b(?:POWER PLANT PROJECT|GEOTHERMAL PROJECT|EXPANSION PROJECT|DEVELOPMENT PROJECT)\b/i.test(line) ||
                    (/\bPROJECT\b/i.test(line) && !/JOB|DWG|DRAWING|DOCUMENT|NO\.|NUMBER|COMMENT|RESPONSE/i.test(line) && line.length >= 8 && line.length <= 100)) {
                    if (/[?!;=]/.test(line)) continue;
                    const prevLine = i > 0 ? lines[i - 1].trim() : '';
                    if (
                        prevLine &&
                        prevLine.length >= 3 &&
                        prevLine.length <= 80 &&
                        !/[?!;=]/.test(prevLine) &&
                        !/LIMITED|CONTRACTOR|OWNER|COMPANY|PT|COMMENT|RESPONSE|REVISION|SHEET|PAGE/i.test(prevLine)
                    ) {
                        project = `${toTitleCase(prevLine)} ${toTitleCase(line)}`;
                    } else {
                        project = toTitleCase(line);
                    }
                    break;
                }
            }
        }

        // Company fallback: look for lines that strictly match company entity names (PT ..., ... LTD, ... CORP, etc.)
        if (!company) {
            for (const line of lines) {
                const trimmed = line.trim();
                // Reject lines with sentence punctuation, question marks, commas or verbs
                if (/[?!:;=]/.test(trimmed)) continue;
                if (/^(?:if|does|is|are|when|why|where|what|how|please|noted|closed|open|update|refer|table|section|page|no\.|rev\.|comment|response)\b/i.test(trimmed)) continue;
                if (/\b(?:submitted|deviation|reference|document|drawing|meeting|recommendation|perimeter|drainage|specification)\b/i.test(trimmed)) continue;

                // Match company legal forms or standard energy/geothermal company signatures
                const isCompanyPattern =
                    /^(?:PT\.?|CV\.?)\s+[A-Z0-9\s&()'-]{3,80}$/i.test(trimmed) ||
                    /\b(?:LIMITED|LTD\.?|CORPORATION|CORP\.?|INC\.?|LLC|GMBH|BERHAD|BHD)\b/i.test(trimmed);

                if (
                    isCompanyPattern &&
                    !/PROJECT|DRAWING|DOCUMENT|SHEET|PAGE|DWG|SECTION|RESPONSE|COMMENT/i.test(trimmed) &&
                    trimmed.length >= 6 &&
                    trimmed.length <= 100
                ) {
                    company = toTitleCase(trimmed);
                    break;
                }
            }
        }

        // Job No. fallback
        if (!jobNo) {
            for (const line of lines) {
                const m = line.match(/\b(2\d{4})\b/);
                if (m) {
                    jobNo = m[1];
                    break;
                }
            }
        }
    }

    const detected = Boolean(docNumber || title);

    return {
        doc_number: docNumber,
        revision,
        title,
        project,
        company,
        job_no: jobNo,
        discipline,
        detected,
    };
}

/**
 * Extracts title block across multi-page drawings using the tag-density classification strategy:
 * 1. Pages with <= 3 engineering tags are classified as document/cover pages.
 *    These contain clean, explicit key-value labels ("Document No. : ...", "Document Title : ...").
 * 2. Pages with > 3 engineering tags are drawing pages with noisy cross-reference tables and are skipped.
 * 3. If no doc pages exist (single-page drawing), it falls back to explicit KV scanning across all pages.
 * 4. Revision auto-detection is deliberately disabled (manual entry only).
 */
export function extractMultiPageTitleBlocks(pageTexts: { page?: number; page_no?: number; text: string }[]): MultiPageTitleBlockResult {
    if (!pageTexts || pageTexts.length === 0) {
        return {
            pages: [],
            is_multi_drawing: false,
            primary: {
                doc_number: null,
                revision: null,
                title: null,
                project: null,
                company: null,
                job_no: null,
                discipline: null,
                detected: false,
            },
            title_detected: false,
        };
    }

    const pages: PageTitleBlock[] = pageTexts.map((pt, idx) => ({
        page: pt.page ?? pt.page_no ?? idx + 1,
        ...extractTitleBlock(pt.text, false),
    }));

    // Classify pages: tag count <= 3 -> doc/cover page, > 3 -> drawing page
    const classified = pageTexts.map((pt, idx) => ({
        page: pt.page ?? pt.page_no ?? idx + 1,
        text: pt.text || '',
        tagCount: countDrawingTags(pt.text || ''),
    }));

    const docPages = classified.filter((p) => p.tagCount <= 3);
    const drawingPages = classified.filter((p) => p.tagCount > 3);

    let docNumber: string | null = null;
    let title: string | null = null;
    let project: string | null = null;
    let company: string | null = null;
    let jobNo: string | null = null;
    let discipline: string | null = null;

    // Strategy 1: Any page with an explicit "Document No." label is authoritative!
    // Document/cover sheets (Pages 1-3) have explicit labeled text: "Document No. : WW3-MP-61-0001"
    for (const pt of pageTexts) {
        const tb = extractTitleBlock(pt.text, true); // kvOnly = true
        if (tb.doc_number) {
            if (!docNumber) docNumber = tb.doc_number;
            if (!title && tb.title) title = tb.title;
            if (!project && tb.project) project = tb.project;
            if (!company && tb.company) company = tb.company;
            if (!jobNo && tb.job_no) jobNo = tb.job_no;
            if (!discipline && tb.discipline) discipline = tb.discipline;
        }
    }

    // Also harvest project/company/job from any doc pages if not yet found
    if (!project || !company || !jobNo) {
        for (const pt of pageTexts) {
            const tb = extractTitleBlock(pt.text, false);
            if (!project && tb.project) project = tb.project;
            if (!company && tb.company) company = tb.company;
            if (!jobNo && tb.job_no) jobNo = tb.job_no;
            if (!discipline && tb.discipline) discipline = tb.discipline;
        }
    }

    // Strategy 2: If no explicit Document No found across pages, fall back to last drawing sheet
    if (!docNumber && drawingPages.length > 0) {
        const lastDrawing = drawingPages[drawingPages.length - 1];
        const tb = extractTitleBlock(lastDrawing.text, false);
        if (!docNumber) docNumber = tb.doc_number;
        if (!title) title = tb.title;
    }

    const detected = Boolean(docNumber || title);

    const primary: TitleBlock = {
        doc_number: docNumber,
        revision: null, // Always manual entry
        title,
        project,
        company,
        job_no: jobNo,
        discipline,
        detected,
    };

    return {
        pages,
        is_multi_drawing: false,
        primary,
        title_detected: detected,
    };
}

/**
 * Builds the display PFD name from TitleBlock metadata.
 * Note: PDF revision is NOT included in the name because PROMIA
 * versioning is independent of PDF drawing revision.
 */
export function buildPfdName(tb: TitleBlock, originalFileName: string): string {
    const baseFallback = path.basename(originalFileName, path.extname(originalFileName));
    if (tb.doc_number && tb.title) {
        return `${tb.doc_number} — ${tb.title}`;
    }
    if (tb.doc_number) {
        return `${tb.doc_number} — ${toTitleCase(baseFallback)}`;
    }
    if (tb.title) {
        return `${tb.title} (${baseFallback})`;
    }
    return baseFallback;
}
