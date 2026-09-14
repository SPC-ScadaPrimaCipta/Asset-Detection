import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/adapters';
import { getConnection, sql } from '../../lib/adapters';
import { readPfdFile } from '../../../lib/pfdStorage';
import { getTagAttributes, getSystemCardAttributes } from '../../../lib/riskAttributes';
import { buildAnnotatedPdf, ExportTag } from '../../../lib/pdfExport';

// Export deliberately shows a fixed, compact set of values (no labels, no
// asset name) rather than the full configurable attribute list from the
// on-screen info panel - keeps the label small enough not to cover the
// drawing. Order: Risk Level, Risk Matrix Name, Next Inspection Year,
// Damage Mechanism(s) (codes only, e.g. "TCO2").
function buildCompactLines(attrs: { risk_level: string | null; risk_matrix_name: string | null; next_inspection_year: number | null; damage_mechanisms: string[] }): string[] {
    return [
        attrs.risk_level ?? '-',
        attrs.risk_matrix_name ?? '-',
        attrs.next_inspection_year != null ? String(attrs.next_inspection_year) : '-',
        attrs.damage_mechanisms.length ? attrs.damage_mechanisms.join(', ') : '-',
    ];
}

// POST: export a PFD version (or a chosen subset of its pages) as a single
// PDF with each tag's live risk color baked in as a highlighter-style
// rectangle and a compact value label next to it. Body: { version_id,
// rbim_id, pages?: number[], labelOffsets?: Record<number, { x: number, y: number }>,
// labelSizes?: Record<number, number>, labelScale?: number, renderWidth?: number }
export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const versionId = parseInt(body?.version_id);
        const rbimId = parseInt(body?.rbim_id);

        if (isNaN(versionId) || isNaN(rbimId)) {
            return NextResponse.json({ success: false, error: 'version_id and rbim_id are required numbers' }, { status: 400 });
        }

        const labelOffsets = typeof body?.labelOffsets === 'object' && body.labelOffsets !== null ? body.labelOffsets : {};
        const labelOffsetsMap = new Map<number, { x: number; y: number }>();
        for (const [key, val] of Object.entries(labelOffsets)) {
            const mapId = parseInt(key);
            if (!isNaN(mapId) && typeof val === 'object' && val !== null) {
                const { x, y } = val as any;
                if (typeof x === 'number' && typeof y === 'number') {
                    labelOffsetsMap.set(mapId, { x, y });
                }
            }
        }

        const pool = await getConnection();

        const versionResult = await pool
            .request()
            .input('versionId', sql.Int, versionId)
            .query(`
                SELECT v.version_id, v.file_path, v.file_name, v.page_count, v.version_no, d.pfd_name, d.public_id, d.drawing_title, d.doc_number
                FROM dbo.rbi_pfd_version v
                INNER JOIN dbo.rbi_pfd_document d ON d.pfd_id = v.pfd_id
                WHERE v.version_id = @versionId
            `);

        if (versionResult.recordset.length === 0) {
            return NextResponse.json({ success: false, error: 'PFD version not found' }, { status: 404 });
        }

        const { file_path: filePath, file_name: fileName, page_count: totalPages, version_no: versionNo, pfd_name: pfdName, public_id: publicId, drawing_title: drawingTitle, doc_number: docNumber } = versionResult.recordset[0];

        const requestedPages: number[] = Array.isArray(body?.pages) ? body.pages.map((p: any) => parseInt(p)).filter((p: number) => !isNaN(p) && p >= 1 && p <= totalPages) : [];
        const pageNumbers = requestedPages.length > 0 ? requestedPages : Array.from({ length: totalPages }, (_, i) => i + 1);

        const mapResult = await pool
            .request()
            .input('versionId', sql.Int, versionId)
            .input('rbimId', sql.Int, rbimId)
            .query(`
                WITH AncestorSeed AS (
                    SELECT DISTINCT m.asset_id AS source_asset_id, m.asset_id, a.parent_id
                    FROM dbo.rbi_pfd_asset_map m
                    INNER JOIN dbo.rbi_asset a ON a.asset_id = m.asset_id
                    WHERE m.version_id = @versionId
                ),
                Ancestors AS (
                    SELECT
                        s.source_asset_id,
                        s.asset_id,
                        s.parent_id,
                        0 AS depth,
                        CAST('/' + CAST(s.asset_id AS varchar(20)) + '/' AS varchar(500)) AS path
                    FROM AncestorSeed s

                    UNION ALL

                    SELECT
                        x.source_asset_id,
                        p.asset_id,
                        p.parent_id,
                        x.depth + 1,
                        CAST(x.path + CAST(p.asset_id AS varchar(20)) + '/' AS varchar(500))
                    FROM Ancestors x
                    INNER JOIN dbo.rbi_asset p
                        ON p.asset_id = x.parent_id
                    WHERE x.path NOT LIKE '%/' + CAST(p.asset_id AS varchar(20)) + '/%'
                ),
                InheritedRiskCandidates AS (
                    SELECT
                        a.source_asset_id,
                        a.asset_id AS ancestor_asset_id,
                        anc.asset_name AS ancestor_asset_name,
                        a.depth,
                        mr.color AS inherited_color,
                        mr.description AS inherited_risk_rank,
                        CAST(r.likelihood AS VARCHAR(10)) + ISNULL(r.consequence, '') AS inherited_risk_level,
                        ROW_NUMBER() OVER (
                            PARTITION BY a.source_asset_id
                            ORDER BY a.depth ASC
                        ) AS rn
                    FROM Ancestors a
                    INNER JOIN dbo.rbi_asset anc
                        ON anc.asset_id = a.asset_id
                    INNER JOIN dbo.rbi_risk r
                        ON r.asset_id = a.asset_id
                       AND r.rbim_id = @rbimId
                    LEFT JOIN dbo.RBI_Model rm
                        ON rm.RBIM_ID = r.rbim_id
                    LEFT JOIN dbo.rbi_matrix_risk mr
                        ON mr.matrix_id = rm.Matrix_ID
                       AND mr.risk_id = r.risk_overall
                    WHERE a.depth > 0
                      AND anc.ct_id NOT IN (6, 8)
                ),
                EquipmentComponentRisks AS (
                    SELECT
                        s.source_asset_id AS equipment_asset_id,
                        c.asset_id AS component_asset_id,
                        c.asset_name AS component_asset_name,
                        r.risk_overall,
                        r.likelihood,
                        r.consequence,
                        mr.color AS component_risk_color,
                        mr.description AS component_risk_rank,
                        CAST(r.likelihood AS VARCHAR(10)) + ISNULL(r.consequence, '') AS component_risk_level,
                        ROW_NUMBER() OVER (
                            PARTITION BY s.source_asset_id
                            ORDER BY r.risk_overall DESC, r.consequence DESC, r.likelihood DESC
                        ) AS rn
                    FROM AncestorSeed s
                    INNER JOIN dbo.rbi_asset a ON a.asset_id = s.source_asset_id
                    INNER JOIN dbo.rbi_asset c ON c.parent_id = s.source_asset_id AND c.ct_id = 12
                    INNER JOIN dbo.rbi_risk r ON r.asset_id = c.asset_id AND r.rbim_id = @rbimId
                    LEFT JOIN dbo.RBI_Model rm ON rm.RBIM_ID = r.rbim_id
                    LEFT JOIN dbo.rbi_matrix_risk mr ON mr.matrix_id = rm.Matrix_ID AND mr.risk_id = r.risk_overall
                    WHERE a.ct_id = 11
                )
                SELECT m.map_id, m.asset_id, a.asset_name, a.ct_id, m.page_no, m.rect_x, m.rect_y, m.rect_width, m.rect_height,
                       CASE WHEN rr.asset_id IS NOT NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_direct_risk,
                       CASE WHEN a.ct_id IN (6, 8, 9, 16) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS is_system_summary,
                       CASE WHEN rr.asset_id IS NULL AND ecr.equipment_asset_id IS NOT NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_component_risk,
                       CASE
                           WHEN rr.asset_id IS NOT NULL THEN mr.color
                           WHEN ecr.equipment_asset_id IS NOT NULL THEN ecr.component_risk_color
                           ELSE irc.inherited_color
                       END AS effective_risk_color,
                       irc.ancestor_asset_id AS inherited_from_asset_id,
                       irc.ancestor_asset_name AS inherited_from_asset_name,
                       irc.inherited_risk_level,
                       irc.inherited_risk_rank,
                       irc.inherited_color AS inherited_risk_color,
                       ll.layout_x, ll.layout_y, ll.box_width, ll.label_scale
                FROM dbo.rbi_pfd_asset_map m
                LEFT JOIN dbo.rbi_asset a ON a.asset_id = m.asset_id
                LEFT JOIN dbo.rbi_risk rr ON rr.asset_id = m.asset_id AND rr.rbim_id = @rbimId
                LEFT JOIN dbo.RBI_Model rm ON rm.RBIM_ID = @rbimId
                LEFT JOIN dbo.rbi_matrix_risk mr ON mr.matrix_id = rm.Matrix_ID AND mr.risk_id = rr.risk_overall
                LEFT JOIN EquipmentComponentRisks ecr ON ecr.equipment_asset_id = m.asset_id AND ecr.rn = 1
                LEFT JOIN InheritedRiskCandidates irc ON irc.source_asset_id = m.asset_id AND irc.rn = 1
                LEFT JOIN dbo.rbi_pfd_label_layout ll ON ll.map_id = m.map_id AND ll.rbim_id = @rbimId
                WHERE m.version_id = @versionId
                ORDER BY m.page_no, m.map_id
                OPTION (MAXRECURSION 20)
            `);

        // Fetch child component assessment cards for mapped equipment (ct_id = 11)
        const childCardsResult = await pool
            .request()
            .input('versionId', sql.Int, versionId)
            .input('rbimId', sql.Int, rbimId)
            .query(`
                SELECT
                    c.parent_id AS equipment_asset_id,
                    c.asset_id,
                    c.asset_name,
                    c.ct_id,
                    c.pos,
                    CAST(r.likelihood AS VARCHAR(10)) + ISNULL(r.consequence, '') AS risk_level,
                    mr.description AS risk_rank,
                    mr.color AS risk_color,
                    r.risk_overall,
                    (
                        SELECT MIN(CASE WHEN TRY_CAST(insp_year AS INT) >= YEAR(GETDATE()) THEN TRY_CAST(insp_year AS INT) END)
                        FROM dbo.rbi_inspection_plan
                        WHERE asset_id = c.asset_id AND rbim_id = @rbimId
                    ) AS next_inspection_year,
                    (
                        SELECT dm.DEG_MECH + ',' AS [text()]
                        FROM dbo.rbi_inspection_plan ip
                        LEFT JOIN dbo.TIG_DEGRADATION_MECHANIS dm ON dm.DEG_MECH_ID = ip.deg_mech_id
                        WHERE ip.asset_id = c.asset_id AND ip.rbim_id = @rbimId AND dm.DEG_MECH IS NOT NULL
                        FOR XML PATH('')
                    ) AS damage_mechanisms_csv
                FROM dbo.rbi_asset c
                INNER JOIN dbo.rbi_risk r ON r.asset_id = c.asset_id AND r.rbim_id = @rbimId
                LEFT JOIN dbo.RBI_Model rm ON rm.RBIM_ID = r.rbim_id
                LEFT JOIN dbo.rbi_matrix_risk mr ON mr.matrix_id = rm.Matrix_ID AND mr.risk_id = r.risk_overall
                WHERE c.parent_id IN (
                    SELECT m.asset_id
                    FROM dbo.rbi_pfd_asset_map m
                    INNER JOIN dbo.rbi_asset a ON a.asset_id = m.asset_id
                    WHERE m.version_id = @versionId AND a.ct_id = 11
                )
                ORDER BY c.parent_id, c.pos, c.asset_name
            `);

        const childCardsByParent = new Map<number, any[]>();
        for (const r of childCardsResult.recordset) {
            const parentId = r.equipment_asset_id;
            if (!childCardsByParent.has(parentId)) {
                childCardsByParent.set(parentId, []);
            }
            const dmgRaw = r.damage_mechanisms_csv || '';
            const damageMechanisms = dmgRaw
                .split(',')
                .map((s: string) => s.trim())
                .filter((s: string) => s.length > 0);
            childCardsByParent.get(parentId)!.push({
                asset_id: r.asset_id,
                asset_name: r.asset_name,
                ct_id: r.ct_id,
                risk_level: r.risk_level,
                risk_rank: r.risk_rank,
                risk_color: r.risk_color,
                risk_overall: r.risk_overall,
                next_inspection_year: r.next_inspection_year ?? null,
                damage_mechanisms: damageMechanisms,
            });
        }
        
        const pageSet = new Set(pageNumbers);
        const tagRows = mapResult.recordset.filter((r: any) => pageSet.has(r.page_no));

        const explicitLabelScale = typeof body?.labelScale === 'number' ? body.labelScale : null;
        const labelSizes: Record<number, number> = typeof body?.labelSizes === 'object' && body.labelSizes !== null ? body.labelSizes : {};
        const renderWidth = typeof body?.renderWidth === 'number' && body.renderWidth > 0 ? body.renderWidth : null;

        const targetDocText = `${drawingTitle || ''} ${docNumber || ''} ${pfdName || ''}`.toLowerCase().replace(/[^a-z0-9]/g, ' ');

        const computeTitleSimilarity = (candidateName: string): number => {
            const clean = (candidateName || '').toLowerCase().replace(/[^a-z0-9]/g, ' ');
            const words = clean.split(/\s+/).filter((w) => w.length > 2 && !['system', 'unit', 'and', 'the', 'for', 'piping', 'diagram'].includes(w));
            let score = 0;
            for (const w of words) {
                if (targetDocText.includes(w)) score += 10;
            }
            return score;
        };

        // Group rows by page to enforce "Single Governing Ancestor System per Page"
        const rowsByPage = new Map<number, any[]>();
        for (const row of tagRows) {
            if (!rowsByPage.has(row.page_no)) rowsByPage.set(row.page_no, []);
            rowsByPage.get(row.page_no)!.push(row);
        }

        const tagsByPage = new Map<number, ExportTag[]>();
        for (const pageNo of Array.from(rowsByPage.keys())) {
            const pageRows = rowsByPage.get(pageNo)!;

            // Pass 1: Check if an explicit assessed title-block / system-summary tag already exists on this page
            let hasExplicitSystemSummary = false;
            for (const row of pageRows) {
                const hasAssessedColor = Boolean(row.effective_risk_color && row.effective_risk_color !== 'null' && row.effective_risk_color !== 'undefined');
                const isUnassessed = !hasAssessedColor || row.risk_rank === 'Unassessed';
                const isSystem = Boolean(row.is_system_summary || (row.ct_id != null && [6, 8, 9, 16].includes(row.ct_id)));
                if (!isUnassessed && isSystem && !row.inherited_from_asset_id) {
                    hasExplicitSystemSummary = true;
                    break;
                }
            }

            // Pass 2: If no explicit system tag exists, score candidate assessed ancestors to pick the SINGLE governing system
            let winningAncestorId: number | null = null;
            if (!hasExplicitSystemSummary) {
                const candidates = new Map<number, { id: number; name: string; count: number }>();
                for (const row of pageRows) {
                    const hasAssessedColor = Boolean(row.effective_risk_color && row.effective_risk_color !== 'null' && row.effective_risk_color !== 'undefined');
                    const isUnassessed = !hasAssessedColor || row.risk_rank === 'Unassessed';
                    if (!isUnassessed && !row.has_direct_risk && !row.has_component_risk && row.inherited_from_asset_id) {
                        const ancId = row.inherited_from_asset_id;
                        if (!candidates.has(ancId)) {
                            candidates.set(ancId, { id: ancId, name: row.inherited_from_asset_name || '', count: 0 });
                        }
                        candidates.get(ancId)!.count++;
                    }
                }

                let highestScore = -1;
                for (const candidate of Array.from(candidates.values())) {
                    const titleSim = computeTitleSimilarity(candidate.name);
                    const totalScore = titleSim * 10 + candidate.count;
                    if (totalScore > highestScore) {
                        highestScore = totalScore;
                        winningAncestorId = candidate.id;
                    }
                }
            }

            // Pass 3: Tag card generation
            let winningCardAssigned = false;
            for (const row of pageRows) {
                const hasDirectRisk = Boolean(row.has_direct_risk);
                const hasComponentRisk = Boolean(row.has_component_risk);
                const hasAssessedColor = Boolean(row.effective_risk_color && row.effective_risk_color !== 'null' && row.effective_risk_color !== 'undefined');
                const isUnassessed = !hasAssessedColor || row.risk_rank === 'Unassessed';
                let isSystemSummary = Boolean(row.is_system_summary || (row.ct_id != null && [6, 8, 9, 16].includes(row.ct_id)));

                let isAncestorSummary = false;
                if (!isUnassessed && !hasDirectRisk && !hasComponentRisk) {
                    if (isSystemSummary && row.inherited_from_asset_id && row.inherited_from_asset_id === winningAncestorId && !winningCardAssigned) {
                        winningCardAssigned = true;
                        isAncestorSummary = true;
                        isSystemSummary = true;
                    } else if (row.inherited_from_asset_id) {
                        isSystemSummary = false;
                    }
                }

                // 1. Unassessed / gray tags NEVER get callout cards
                // 2. Regular equipment/piping with only inherited risk gets highlight only (NO card)
                // 3. Assessed Doc Title / System Summary OR Direct Risk / Composite Equipment gets a card:
                const shouldHaveCard = !isUnassessed && (isSystemSummary || hasDirectRisk || hasComponentRisk);
                const targetAssetId = isAncestorSummary && row.inherited_from_asset_id ? row.inherited_from_asset_id : row.asset_id;
                const attrs = shouldHaveCard
                    ? (isSystemSummary ? await getSystemCardAttributes(targetAssetId, rbimId, pool) : await getTagAttributes(targetAssetId, rbimId, pool))
                    : null;
                const clientOffset = labelOffsetsMap.get(row.map_id);
                const labelX = clientOffset ? clientOffset.x : (row.layout_x != null ? Number(row.layout_x) : null);
                const labelY = clientOffset ? clientOffset.y : (row.layout_y != null ? Number(row.layout_y) : null);
                const customBoxWidth = labelSizes[row.map_id] || (row.box_width != null ? Number(row.box_width) : 135);
                const itemLabelScale = explicitLabelScale ?? (row.label_scale != null ? Number(row.label_scale) : 75);

                let riskCards: any[] = [];
                const effectiveDisplayName = isAncestorSummary && row.inherited_from_asset_name
                    ? row.inherited_from_asset_name
                    : (row.asset_name || `Asset #${row.asset_id}`);

                if (shouldHaveCard) {
                    if (hasComponentRisk && childCardsByParent.has(row.asset_id)) {
                        riskCards = childCardsByParent.get(row.asset_id)!;
                    } else if (attrs && (attrs.risk_color || row.effective_risk_color)) {
                        riskCards = [
                            {
                                asset_id: targetAssetId,
                                asset_name: effectiveDisplayName,
                                risk_level: attrs.risk_level != null ? String(attrs.risk_level) : (attrs.risk_rank != null ? String(attrs.risk_rank) : '-'),
                                risk_rank: attrs.risk_rank,
                                risk_color: row.effective_risk_color || attrs.risk_color,
                                next_inspection_year: attrs.next_inspection_year ?? null,
                                damage_mechanisms: attrs.damage_mechanisms ?? [],
                            },
                        ];
                    }
                }

                const tag: ExportTag = {
                    map_id: row.map_id,
                    page_no: row.page_no,
                    rect_x: row.rect_x,
                    rect_y: row.rect_y,
                    rect_width: row.rect_width,
                    rect_height: row.rect_height,
                    color_hex: row.effective_risk_color ?? null,
                    has_direct_risk: Boolean(shouldHaveCard && (attrs?.risk_color || row.effective_risk_color)),
                    is_system_summary: isSystemSummary,
                    ct_id: row.ct_id,
                    asset_name: effectiveDisplayName,
                    risk_level: attrs?.risk_level != null ? String(attrs.risk_level) : (attrs?.risk_rank != null ? String(attrs.risk_rank) : '-'),
                    risk_model: attrs?.risk_model || attrs?.risk_matrix_name || '',
                    next_inspection_year: attrs?.next_inspection_year ?? null,
                    damage_mechanisms: attrs?.damage_mechanisms ?? [],
                    risk_cards: riskCards,
                    label_x: labelX,
                    label_y: labelY,
                    box_width: customBoxWidth,
                    label_scale: itemLabelScale,
                    render_width: renderWidth,
                };
                if (!tagsByPage.has(row.page_no)) tagsByPage.set(row.page_no, []);
                tagsByPage.get(row.page_no)!.push(tag);
            }
        }

        const sourceBuffer = await readPfdFile(filePath);
        const outputBuffer = await buildAnnotatedPdf(sourceBuffer, pageNumbers, tagsByPage);

        const exportName = fileName.replace(/\.pdf$/i, '') + '_export.pdf';

        let cloudWebUrl = '';
        try {
            const { getConfiguredBackend, putFile, getPresignedDownloadUrl } = await import('../../../lib/storageAdapter');
            const backend = getConfiguredBackend();

            if (backend === 'sharepoint') {
                const spSiteId = process.env.SHAREPOINT_SITE_ID;
                if (spSiteId) {
                    const uploaded = await putFile({
                        category: 'pfd_export',
                        identifier: publicId,
                        subPath: versionNo,
                        fileName: exportName,
                        buffer: Buffer.from(outputBuffer),
                        mimeType: 'application/pdf',
                    });
                    // For SharePoint, fetch the webUrl
                    if (uploaded.relPath.startsWith('sp:')) {
                        const { getAppAccessToken } = await import('@/lib/msGraph');
                        const { getDriveItemInfo } = await import('@/lib/sharepoint');
                        const { accessToken } = await getAppAccessToken();
                        const info = await getDriveItemInfo({ siteId: spSiteId, accessToken, itemId: uploaded.relPath.substring(3) });
                        if (info?.webUrl) {
                            cloudWebUrl = info.webUrl;
                        }
                    }
                }
            } else if (backend === 's3') {
                const uploaded = await putFile({
                    category: 'pfd_export',
                    identifier: publicId,
                    subPath: versionNo,
                    fileName: exportName,
                    buffer: Buffer.from(outputBuffer),
                    mimeType: 'application/pdf',
                });
                const presigned = await getPresignedDownloadUrl(uploaded.relPath, 86400); // 24h
                if (presigned) {
                    cloudWebUrl = presigned;
                }
            }
        } catch (err) {
            console.error('Failed to upload export to cloud storage:', err);
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${exportName}"`,
        };
        if (cloudWebUrl) {
            headers['X-Cloud-Url'] = cloudWebUrl;
            headers['X-SharePoint-Url'] = cloudWebUrl; // backward compat
            headers['Access-Control-Expose-Headers'] = 'X-Cloud-Url, X-SharePoint-Url';
        }

        return new NextResponse(new Uint8Array(outputBuffer), {
            status: 200,
            headers,
        });
    } catch (error: any) {
        console.error('Export PDF error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}


