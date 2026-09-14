import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isRiskMappingEditor } from '@/lib/authz';
import { getConnection, sql } from '@/lib/db';
import { handleRiskMappingApiError } from '@/lib/riskMappingApiError';

// GET: list asset mappings for a PFD version (?version_id=), optionally
// joined with live risk color/level for a model (?rbim_id=) so the viewer
// can paint each tag by its current risk instead of a flat neutral color.
export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const versionId = request.nextUrl.searchParams.get('version_id');
    if (!versionId || isNaN(parseInt(versionId))) {
        return NextResponse.json({ success: false, error: 'version_id is required' }, { status: 400 });
    }
    const rbimIdRaw = request.nextUrl.searchParams.get('rbim_id');
    const rbimId = rbimIdRaw && !isNaN(parseInt(rbimIdRaw)) ? parseInt(rbimIdRaw) : null;

    try {
        const pool = await getConnection();
        const req = pool.request().input('versionId', sql.Int, parseInt(versionId));

        // Batch recursive CTE for asset hierarchy risk inheritance when rbim_id is specified.
        // Determines direct risk vs nearest ancestor risk with cycle detection.
        const riskCte = rbimId
            ? `;WITH AncestorSeed AS (
                   SELECT DISTINCT m.asset_id
                   FROM dbo.rbi_pfd_asset_map m
                   WHERE m.version_id = @versionId
               ),
               Ancestors AS (
                   SELECT
                       s.asset_id AS source_asset_id,
                       a.asset_id,
                       a.parent_id,
                       0 AS depth,
                       CAST('/' + CAST(a.asset_id AS varchar(20)) + '/' AS varchar(500)) AS path
                   FROM AncestorSeed s
                   INNER JOIN dbo.rbi_asset a
                       ON a.asset_id = s.asset_id

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
                        s.asset_id AS equipment_asset_id,
                        c.asset_id AS component_asset_id,
                        c.asset_name AS component_asset_name,
                        r.risk_overall,
                        r.likelihood,
                        r.consequence,
                        mr.color AS component_risk_color,
                        mr.description AS component_risk_rank,
                        CAST(r.likelihood AS VARCHAR(10)) + ISNULL(r.consequence, '') AS component_risk_level,
                        ROW_NUMBER() OVER (
                            PARTITION BY s.asset_id
                            ORDER BY r.risk_overall DESC, r.consequence DESC, r.likelihood DESC
                        ) AS rn,
                        COUNT(*) OVER (PARTITION BY s.asset_id) AS total_assessed_components
                    FROM AncestorSeed s
                    INNER JOIN dbo.rbi_asset a ON a.asset_id = s.asset_id
                    INNER JOIN dbo.rbi_asset c ON c.parent_id = s.asset_id AND c.ct_id = 12
                    INNER JOIN dbo.rbi_risk r ON r.asset_id = c.asset_id AND r.rbim_id = @rbimId
                    LEFT JOIN dbo.RBI_Model rm ON rm.RBIM_ID = r.rbim_id
                    LEFT JOIN dbo.rbi_matrix_risk mr ON mr.matrix_id = rm.Matrix_ID AND mr.risk_id = r.risk_overall
                    WHERE a.ct_id = 11
                )`
            : '';

        const riskSelect = rbimId
            ? `, CASE WHEN rr.asset_id IS NOT NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_direct_risk,
               CASE WHEN a.ct_id IN (6, 8, 9, 16) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS is_system_summary,
               CASE WHEN rr.asset_id IS NULL AND ecr.equipment_asset_id IS NOT NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_component_risk,
               mr.color AS direct_risk_color,
               irc.inherited_color AS inherited_risk_color,
               ecr.component_risk_color,
               CASE
                   WHEN rr.asset_id IS NOT NULL THEN mr.color
                   WHEN ecr.equipment_asset_id IS NOT NULL THEN ecr.component_risk_color
                   ELSE irc.inherited_color
               END AS effective_risk_color,
               mr.color AS risk_color,
               CASE
                   WHEN rr.asset_id IS NOT NULL THEN mr.description
                   WHEN ecr.equipment_asset_id IS NOT NULL THEN ecr.component_risk_rank
                   ELSE irc.inherited_risk_rank
               END AS risk_rank,
               CASE
                   WHEN rr.asset_id IS NOT NULL THEN CAST(rr.likelihood AS VARCHAR(10)) + ISNULL(rr.consequence, '')
                   WHEN ecr.equipment_asset_id IS NOT NULL THEN ecr.component_risk_level
                   ELSE irc.inherited_risk_level
               END AS risk_level,
               ecr.component_asset_name AS governing_component_name,
               ecr.total_assessed_components,
               irc.ancestor_asset_id AS inherited_from_asset_id,
               irc.ancestor_asset_name AS inherited_from_asset_name,
               irc.inherited_risk_level,
               irc.inherited_risk_rank,
               ll.layout_x,
               ll.layout_y,
               ll.box_width AS layout_box_width,
               ll.label_scale AS layout_label_scale`
            : `, CAST(0 AS bit) AS is_system_summary,
               CAST(0 AS bit) AS has_component_risk,
               NULL AS governing_component_name,
               NULL AS total_assessed_components,
               NULL AS inherited_from_asset_id,
               NULL AS inherited_from_asset_name,
               NULL AS inherited_risk_level,
               NULL AS inherited_risk_rank`;
        const riskJoin = rbimId
            ? `LEFT JOIN dbo.rbi_risk rr ON rr.asset_id = m.asset_id AND rr.rbim_id = @rbimId
               LEFT JOIN dbo.RBI_Model rm ON rm.RBIM_ID = @rbimId
               LEFT JOIN dbo.rbi_matrix_type mt ON mt.matrix_id = rm.Matrix_ID
               LEFT JOIN dbo.rbi_matrix_risk mr ON mr.matrix_id = rm.Matrix_ID AND mr.risk_id = rr.risk_overall
               LEFT JOIN EquipmentComponentRisks ecr ON ecr.equipment_asset_id = m.asset_id AND ecr.rn = 1
               LEFT JOIN InheritedRiskCandidates irc ON irc.source_asset_id = m.asset_id AND irc.rn = 1
               LEFT JOIN dbo.rbi_pfd_label_layout ll ON ll.map_id = m.map_id AND ll.rbim_id = @rbimId`
            : '';
        if (rbimId) req.input('rbimId', sql.Int, rbimId);

        const result = await req.query(`
            ${riskCte}
            SELECT m.map_id, m.version_id, m.asset_id, a.asset_name, a.ct_id,
                   h.DESCRIPTION AS asset_description,
                   m.page_no,
                   m.rect_x, m.rect_y, m.rect_width, m.rect_height,
                   m.matched_text, m.detection_mode,
                   m.created_by, m.created_at, m.updated_by, m.updated_at
                   ${riskSelect}
            FROM dbo.rbi_pfd_asset_map m
            LEFT JOIN dbo.rbi_asset a ON a.asset_id = m.asset_id
            LEFT JOIN dbo.CIG_HEADING h ON h.Asset_ID = a.asset_id
            ${riskJoin}
            WHERE m.version_id = @versionId
            ORDER BY m.page_no, m.map_id
            ${rbimId ? 'OPTION (MAXRECURSION 20)' : ''}
        `);

        if (rbimId && result.recordset.length > 0) {
            // 1. Fetch child component assessment cards for mapped equipment (ct_id = 11)
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
                        ch.DESCRIPTION AS asset_description,
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
                    LEFT JOIN dbo.CIG_HEADING ch ON ch.Asset_ID = c.asset_id
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
                    asset_description: r.asset_description ? String(r.asset_description).trim() : null,
                    ct_id: r.ct_id,
                    risk_level: r.risk_level,
                    risk_rank: r.risk_rank,
                    risk_color: r.risk_color,
                    risk_overall: r.risk_overall,
                    next_inspection_year: r.next_inspection_year ?? null,
                    damage_mechanisms: damageMechanisms,
                });
            }

            // 2. Fetch direct inspection plans for directly assessed mapped assets
            const directPlansResult = await pool
                .request()
                .input('versionId', sql.Int, versionId)
                .input('rbimId', sql.Int, rbimId)
                .query(`
                    SELECT
                        m.asset_id,
                        (
                            SELECT MIN(CASE WHEN TRY_CAST(insp_year AS INT) >= YEAR(GETDATE()) THEN TRY_CAST(insp_year AS INT) END)
                            FROM dbo.rbi_inspection_plan
                            WHERE asset_id = m.asset_id AND rbim_id = @rbimId
                        ) AS next_inspection_year,
                        (
                            SELECT dm.DEG_MECH + ',' AS [text()]
                            FROM dbo.rbi_inspection_plan ip
                            LEFT JOIN dbo.TIG_DEGRADATION_MECHANIS dm ON dm.DEG_MECH_ID = ip.deg_mech_id
                            WHERE ip.asset_id = m.asset_id AND ip.rbim_id = @rbimId AND dm.DEG_MECH IS NOT NULL
                            FOR XML PATH('')
                        ) AS damage_mechanisms_csv
                    FROM dbo.rbi_pfd_asset_map m
                    INNER JOIN dbo.rbi_risk r ON r.asset_id = m.asset_id AND r.rbim_id = @rbimId
                    WHERE m.version_id = @versionId
                `);

            const directPlansByAsset = new Map<number, { next_inspection_year: number | null; damage_mechanisms: string[] }>();
            for (const r of directPlansResult.recordset) {
                const dmgRaw = r.damage_mechanisms_csv || '';
                const damageMechanisms = dmgRaw
                    .split(',')
                    .map((s: string) => s.trim())
                    .filter((s: string) => s.length > 0);
                directPlansByAsset.set(r.asset_id, {
                    next_inspection_year: r.next_inspection_year ?? null,
                    damage_mechanisms: damageMechanisms,
                });
            }

            // 3. Fetch aggregated inspection plans for distinct ancestor systems
            const ancestorAssetIds = Array.from(
                new Set(
                    result.recordset
                        .map((r: any) => r.inherited_from_asset_id)
                        .filter((id: any) => id != null && typeof id === 'number')
                )
            );

            const ancestorPlansByAsset = new Map<number, { next_inspection_year: number | null; damage_mechanisms: string[] }>();
            if (ancestorAssetIds.length > 0) {
                const ancestorPlansResult = await pool
                    .request()
                    .input('rbimId', sql.Int, rbimId)
                    .query(`
                        WITH TargetAndDescendants AS (
                            SELECT a.asset_id, 0 AS depth, CAST('/' + CAST(a.asset_id AS varchar(20)) + '/' AS varchar(500)) AS path, a.asset_id AS root_ancestor_id
                            FROM dbo.rbi_asset a
                            WHERE a.asset_id IN (${ancestorAssetIds.join(',')})

                            UNION ALL

                            SELECT c.asset_id, td.depth + 1, CAST(td.path + CAST(c.asset_id AS varchar(20)) + '/' AS varchar(500)), td.root_ancestor_id
                            FROM dbo.rbi_asset c
                            JOIN TargetAndDescendants td ON c.parent_id = td.asset_id
                            WHERE td.path NOT LIKE '%/' + CAST(c.asset_id AS varchar(20)) + '/%'
                        )
                        SELECT td.root_ancestor_id AS ancestor_asset_id,
                               MIN(CASE WHEN TRY_CAST(ip.insp_year AS INT) >= YEAR(GETDATE()) THEN TRY_CAST(ip.insp_year AS INT) END) AS next_inspection_year,
                               (
                                   SELECT DISTINCT dm.DEG_MECH + ',' AS [text()]
                                   FROM dbo.rbi_inspection_plan ip2
                                   LEFT JOIN dbo.TIG_DEGRADATION_MECHANIS dm ON dm.DEG_MECH_ID = ip2.deg_mech_id
                                   WHERE ip2.asset_id IN (SELECT td2.asset_id FROM TargetAndDescendants td2 WHERE td2.root_ancestor_id = td.root_ancestor_id)
                                     AND ip2.rbim_id = @rbimId AND dm.DEG_MECH IS NOT NULL
                                   FOR XML PATH('')
                               ) AS damage_mechanisms_csv
                        FROM TargetAndDescendants td
                        LEFT JOIN dbo.rbi_inspection_plan ip ON ip.asset_id = td.asset_id AND ip.rbim_id = @rbimId
                        GROUP BY td.root_ancestor_id
                        OPTION (MAXRECURSION 20)
                    `);

                for (const r of ancestorPlansResult.recordset) {
                    const dmgRaw = r.damage_mechanisms_csv || '';
                    const damageMechanisms = dmgRaw
                        .split(',')
                        .map((s: string) => s.trim())
                        .filter((s: string) => s.length > 0);
                    ancestorPlansByAsset.set(r.ancestor_asset_id, {
                        next_inspection_year: r.next_inspection_year ?? null,
                        damage_mechanisms: damageMechanisms,
                    });
                }
            }

            // 4. Query document metadata for title similarity matching
            const docMetaResult = await pool
                .request()
                .input('versionId', sql.Int, versionId)
                .query(`
                    SELECT d.drawing_title, d.pfd_name, d.doc_number, d.asset_id AS doc_asset_id
                    FROM dbo.rbi_pfd_version v
                    INNER JOIN dbo.rbi_pfd_document d ON d.pfd_id = v.pfd_id
                    WHERE v.version_id = @versionId
                `);
            const docMeta = docMetaResult.recordset[0] || {};
            const targetDocText = `${docMeta.drawing_title || ''} ${docMeta.doc_number || ''} ${docMeta.pfd_name || ''}`.toLowerCase().replace(/[^a-z0-9]/g, ' ');

            const computeTitleSimilarity = (candidateName: string): number => {
                const clean = (candidateName || '').toLowerCase().replace(/[^a-z0-9]/g, ' ');
                const words = clean.split(/\s+/).filter((w) => w.length > 2 && !['system', 'unit', 'and', 'the', 'for', 'piping', 'diagram'].includes(w));
                let score = 0;
                for (const w of words) {
                    if (targetDocText.includes(w)) score += 10;
                }
                return score;
            };

            // 5. Attach risk_cards & apply "Single Governing Ancestor System per Page" (prioritizing drawing title)
            const rowsByPage = new Map<number, any[]>();
            for (const row of result.recordset) {
                const pageNo = row.page_no || 1;
                if (!rowsByPage.has(pageNo)) rowsByPage.set(pageNo, []);
                rowsByPage.get(pageNo)!.push(row);
            }

            for (const pageNo of Array.from(rowsByPage.keys())) {
                const pageRows = rowsByPage.get(pageNo)!;

                // Pass 1: Check if an explicit assessed title-block / system-summary tag already exists on this page
                let hasExplicitSystemSummary = false;
                for (const row of pageRows) {
                    const hasAssessedColor = Boolean(row.effective_risk_color && row.effective_risk_color !== 'null' && row.effective_risk_color !== 'undefined');
                    const isUnassessed = !hasAssessedColor || row.risk_rank === 'Unassessed';
                    if (!isUnassessed && row.is_system_summary && !row.inherited_from_asset_id) {
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

                // Pass 3: Assign cards and suppress foreign ancestor summaries / tie-ins
                let winningCardAssigned = false;
                for (const row of pageRows) {
                    const hasAssessedColor = Boolean(row.effective_risk_color && row.effective_risk_color !== 'null' && row.effective_risk_color !== 'undefined');
                    const isUnassessed = !hasAssessedColor || row.risk_rank === 'Unassessed';

                    if (row.has_component_risk && childCardsByParent.has(row.asset_id)) {
                        row.risk_cards = childCardsByParent.get(row.asset_id)!;
                        row.is_ancestor_summary = false;
                    } else if (row.has_direct_risk) {
                        const plan = directPlansByAsset.get(row.asset_id);
                        row.risk_cards = [
                            {
                                asset_id: row.asset_id,
                                asset_name: row.asset_name,
                                ct_id: row.ct_id,
                                risk_level: row.risk_level,
                                risk_rank: row.risk_rank,
                                risk_color: row.direct_risk_color || row.effective_risk_color,
                                next_inspection_year: plan?.next_inspection_year ?? null,
                                damage_mechanisms: plan?.damage_mechanisms ?? [],
                            },
                        ];
                        row.is_ancestor_summary = false;
                    } else if (!isUnassessed && row.is_system_summary && row.inherited_from_asset_id && row.inherited_from_asset_id === winningAncestorId && !winningCardAssigned) {
                        // Consolidate exactly 1 card for the governing assessed ancestor system on the explicit title/system tag
                        winningCardAssigned = true;
                        row.is_ancestor_summary = true;
                        row.is_system_summary = true;
                        const ancPlan = ancestorPlansByAsset.get(row.inherited_from_asset_id);
                        row.risk_cards = [
                            {
                                asset_id: row.inherited_from_asset_id,
                                asset_name: row.inherited_from_asset_name || `System #${row.inherited_from_asset_id}`,
                                ct_id: 9,
                                risk_level: row.inherited_risk_level || row.risk_level,
                                risk_rank: row.inherited_risk_rank || row.risk_rank,
                                risk_color: row.inherited_risk_color || row.effective_risk_color,
                                next_inspection_year: ancPlan?.next_inspection_year ?? null,
                                damage_mechanisms: ancPlan?.damage_mechanisms ?? [],
                            },
                        ];
                    } else {
                        row.is_ancestor_summary = false;
                        row.risk_cards = [];
                        if (row.inherited_from_asset_id) {
                            row.is_system_summary = false;
                        }
                    }
                }
            }
        } else {
            for (const row of result.recordset) {
                row.risk_cards = [];
            }
        }

        return NextResponse.json({ success: true, data: result.recordset });
    } catch (error: any) {
        console.error('Map list error:', error);
        return handleRiskMappingApiError(error, 'Map list error');
    }
}

// POST: create an asset mapping (editor-only)
export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isRiskMappingEditor(session)) {
        return NextResponse.json({ success: false, error: 'Forbidden - editor role required' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { version_id, asset_id, page_no, rect_x, rect_y, rect_width, rect_height, matched_text, detection_mode } = body;

        if (!version_id || !asset_id || !page_no) {
            return NextResponse.json({ success: false, error: 'version_id, asset_id and page_no are required' }, { status: 400 });
        }
        if ([rect_x, rect_y, rect_width, rect_height].some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
            return NextResponse.json({ success: false, error: 'rect_x, rect_y, rect_width, rect_height must be non-negative numbers' }, { status: 400 });
        }
        const mode = detection_mode === 'AUTO' ? 'AUTO' : 'MANUAL';

        const pool = await getConnection();

        const versionResult = await pool.request().input('versionId', sql.Int, version_id).query('SELECT page_count FROM dbo.rbi_pfd_version WHERE version_id = @versionId');
        if (versionResult.recordset.length === 0) {
            return NextResponse.json({ success: false, error: 'version_id does not exist' }, { status: 400 });
        }
        const { page_count: pageCount } = versionResult.recordset[0];
        if (page_no < 1 || page_no > pageCount) {
            return NextResponse.json({ success: false, error: `page_no must be between 1 and ${pageCount}` }, { status: 400 });
        }

        // rbi_asset has no FK support (no unique key), so validate existence in app code
        const assetCheck = await pool.request().input('assetId', sql.Int, asset_id).query('SELECT asset_id FROM dbo.rbi_asset WHERE asset_id = @assetId');
        if (assetCheck.recordset.length === 0) {
            return NextResponse.json({ success: false, error: 'asset_id does not exist' }, { status: 400 });
        }

        const createdBy = (session.user as any)?.id || 'unknown';

        const insertResult = await pool
            .request()
            .input('version_id', sql.Int, version_id)
            .input('asset_id', sql.Int, asset_id)
            .input('page_no', sql.Int, page_no)
            .input('rect_x', sql.Float, rect_x)
            .input('rect_y', sql.Float, rect_y)
            .input('rect_width', sql.Float, rect_width)
            .input('rect_height', sql.Float, rect_height)
            .input('matched_text', sql.NVarChar(200), typeof matched_text === 'string' ? matched_text : null)
            .input('detection_mode', sql.VarChar(10), mode)
            .input('created_by', sql.VarChar(50), createdBy)
            .query(`
                INSERT INTO dbo.rbi_pfd_asset_map
                    (version_id, asset_id, page_no, rect_x, rect_y, rect_width, rect_height, matched_text, detection_mode, created_by)
                OUTPUT INSERTED.map_id
                VALUES
                    (@version_id, @asset_id, @page_no, @rect_x, @rect_y, @rect_width, @rect_height, @matched_text, @detection_mode, @created_by)
            `);

        return NextResponse.json({ success: true, data: { map_id: insertResult.recordset[0].map_id } }, { status: 201 });
    } catch (error: any) {
        console.error('Map create error:', error);
        return handleRiskMappingApiError(error, 'Map create error');
    }
}