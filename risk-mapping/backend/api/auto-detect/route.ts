import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isRiskMappingEditor } from '@/lib/authz';
import { getConnection, sql } from '@/lib/db';
import { readPfdFile } from '@/lib/pfdStorage';
import { searchPdfText } from '@/lib/pdfRender';
import { getCandidateVariants } from '@/lib/pfdAutoTag';

// POST: scan a PFD version's PDF for asset tag text and suggest matches
// (editor-only, review-before-write - nothing is inserted into
// rbi_pfd_asset_map here). Candidates are restricted to an asset (default:
// the PFD's own linked asset, rbi_pfd_document.asset_id; override with
// root_asset_id when a drawing depicts equipment from a different asset
// hierarchy than the one the PFD is officially linked to) and its
// descendants, matched by exact (case-insensitive) substring of asset_name
// against the page text. Assets already tagged anywhere in this version are
// skipped so re-running after a partial review doesn't keep re-suggesting
// confirmed tags.
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
        const versionId = parseInt(body.version_id);
        if (isNaN(versionId)) {
            return NextResponse.json({ success: false, error: 'version_id is required' }, { status: 400 });
        }
        const overrideAssetIdRaw = body.root_asset_id;
        const overrideAssetId = overrideAssetIdRaw != null ? parseInt(overrideAssetIdRaw) : NaN;
        if (overrideAssetIdRaw != null && isNaN(overrideAssetId)) {
            return NextResponse.json({ success: false, error: 'root_asset_id must be a number' }, { status: 400 });
        }

        const pool = await getConnection();

        const versionResult = await pool
            .request()
            .input('versionId', sql.Int, versionId)
            .query(`
                SELECT v.version_id, v.file_path, v.page_count, d.asset_id AS root_asset_id
                FROM dbo.rbi_pfd_version v
                INNER JOIN dbo.rbi_pfd_document d ON d.pfd_id = v.pfd_id
                WHERE v.version_id = @versionId
            `);
        if (versionResult.recordset.length === 0) {
            return NextResponse.json({ success: false, error: 'version_id does not exist' }, { status: 400 });
        }
        const { file_path: filePath, root_asset_id: linkedAssetId } = versionResult.recordset[0];

        let rootAssetId = linkedAssetId;
        if (!isNaN(overrideAssetId)) {
            const assetCheck = await pool.request().input('assetId', sql.Int, overrideAssetId).query('SELECT asset_id FROM dbo.rbi_asset WHERE asset_id = @assetId');
            if (assetCheck.recordset.length === 0) {
                return NextResponse.json({ success: false, error: 'root_asset_id does not exist' }, { status: 400 });
            }
            rootAssetId = overrideAssetId;
        }

        // Same recursive-descendants pattern as /api/risk-analysis/asset-children.
        const candidatesResult = await pool
            .request()
            .input('assetId', sql.Int, rootAssetId)
            .query(`
                WITH AssetHierarchy AS (
                    SELECT asset_id, parent_id, ct_id, asset_name
                    FROM dbo.rbi_asset
                    WHERE asset_id = @assetId

                    UNION ALL

                    SELECT a.asset_id, a.parent_id, a.ct_id, a.asset_name
                    FROM dbo.rbi_asset a
                    INNER JOIN AssetHierarchy ah ON a.parent_id = ah.asset_id
                    WHERE a.asset_id != a.parent_id
                )
                SELECT ah.asset_id, ah.parent_id, ah.ct_id, ah.asset_name, pa.asset_name AS parent_name, pa.ct_id AS parent_ct_id
                FROM AssetHierarchy ah
                LEFT JOIN dbo.rbi_asset pa ON pa.asset_id = ah.parent_id
            `);

        // If user confirmed cleanup, execute deletion now
        if (body.action === 'cleanup') {
            const mapIds = Array.isArray(body.map_ids) ? body.map_ids.map((id: any) => parseInt(id)).filter((id: any) => !isNaN(id)) : null;
            let query = '';
            const req = pool.request().input('versionId', sql.Int, versionId);

            if (mapIds && mapIds.length > 0) {
                const paramNames = mapIds.map((id: number, i: number) => {
                    const p = `m${i}`;
                    req.input(p, sql.Int, id);
                    return `@${p}`;
                });
                query = `
                    DELETE FROM dbo.rbi_pfd_asset_map
                    WHERE version_id = @versionId
                      AND map_id IN (${paramNames.join(', ')})
                `;
            } else {
                req.input('assetId', sql.Int, rootAssetId);
                query = `
                    WITH AssetHierarchy AS (
                        SELECT asset_id
                        FROM dbo.rbi_asset
                        WHERE asset_id = @assetId

                        UNION ALL

                        SELECT a.asset_id
                        FROM dbo.rbi_asset a
                        INNER JOIN AssetHierarchy ah ON a.parent_id = ah.asset_id
                        WHERE a.asset_id != a.parent_id
                    )
                    DELETE FROM dbo.rbi_pfd_asset_map
                    WHERE version_id = @versionId
                      AND asset_id NOT IN (SELECT asset_id FROM AssetHierarchy);
                `;
            }

            const delRes = await req.query(query);
            return NextResponse.json({
                success: true,
                message: `Cleaned up ${delRes.rowsAffected[0] || 0} tag(s)`,
                tags_removed: delRes.rowsAffected[0] || 0,
            });
        }

        // Scan mode: detect irrelevant tags currently on the drawing outside rootAssetId's hierarchy
        const irrelevantResult = await pool
            .request()
            .input('versionId', sql.Int, versionId)
            .input('assetId', sql.Int, rootAssetId)
            .query(`
                WITH AssetHierarchy AS (
                    SELECT asset_id
                    FROM dbo.rbi_asset
                    WHERE asset_id = @assetId

                    UNION ALL

                    SELECT a.asset_id
                    FROM dbo.rbi_asset a
                    INNER JOIN AssetHierarchy ah ON a.parent_id = ah.asset_id
                    WHERE a.asset_id != a.parent_id
                )
                SELECT
                    m.map_id,
                    m.asset_id,
                    ISNULL(a.asset_name, 'Asset #' + CAST(m.asset_id AS VARCHAR(20))) AS asset_name,
                    m.page_no,
                    m.rect_x,
                    m.rect_y,
                    m.rect_width,
                    m.rect_height,
                    m.matched_text,
                    m.detection_mode
                FROM dbo.rbi_pfd_asset_map m
                LEFT JOIN dbo.rbi_asset a ON a.asset_id = m.asset_id
                WHERE m.version_id = @versionId
                  AND m.asset_id NOT IN (SELECT asset_id FROM AssetHierarchy);
            `);

        const irrelevantTags = irrelevantResult.recordset.map((r: any) => ({
            map_id: r.map_id,
            asset_id: r.asset_id,
            asset_name: r.asset_name,
            page_no: r.page_no,
            rect_x: r.rect_x,
            rect_y: r.rect_y,
            rect_width: r.rect_width,
            rect_height: r.rect_height,
            matched_text: r.matched_text,
            detection_mode: r.detection_mode,
        }));

        const alreadyTaggedResult = await pool
            .request()
            .input('versionId', sql.Int, versionId)
            .query('SELECT page_no, asset_id FROM dbo.rbi_pfd_asset_map WHERE version_id = @versionId');
        const alreadyTaggedOnPage = new Set<string>(
            alreadyTaggedResult.recordset.map((r: any) => `${r.page_no}_${r.asset_id}`)
        );

        interface CandidateItem {
            asset_id: number;
            asset_name: string;
            parent_id?: number | null;
            parent_name?: string | null;
            ct_id?: number | null;
            parent_ct_id?: number | null;
        }
        const candidatesByKey = new Map<string, CandidateItem>();
        for (const row of candidatesResult.recordset as any[]) {
            const name = (row.asset_name || '').trim();
            if (name.length < 2) continue; // too short to search meaningfully, would match everywhere
            candidatesByKey.set(String(row.asset_id), {
                asset_id: row.asset_id,
                asset_name: name,
                parent_id: row.parent_id,
                parent_name: row.parent_name,
                ct_id: row.ct_id,
                parent_ct_id: row.parent_ct_id,
            });
        }

        if (candidatesByKey.size === 0) {
            return NextResponse.json({ success: true, data: { matches: [], candidate_count: 0, irrelevant_tags: irrelevantTags } });
        }

        const buffer = await readPfdFile(filePath);
        const needles: { key: string; text: string }[] = [];
        candidatesByKey.forEach((c, key) => {
            const variants = getCandidateVariants(c.asset_name, c.ct_id);
            for (let i = 0; i < variants.length; i++) {
                needles.push({ key, text: variants[i] });
            }
        });
        const hits = await searchPdfText(buffer, needles);

        const seenOnScan = new Set<string>();
        const matches: any[] = [];

        for (let i = 0; i < hits.length; i++) {
            const hit = hits[i];
            const candidate = candidatesByKey.get(hit.key);
            if (!candidate) continue;

            const isTitleBlockZone = hit.rect.x > 70 && hit.rect.y > 75;
            const isChildPipingEquipment = (candidate.ct_id === 21 || candidate.ct_id === 22) && candidate.parent_ct_id === 9;
            const targetAssetId = isTitleBlockZone && isChildPipingEquipment && candidate.parent_id ? candidate.parent_id : candidate.asset_id;
            const targetAssetName = isTitleBlockZone && isChildPipingEquipment && candidate.parent_name ? candidate.parent_name : candidate.asset_name;

            // Skip if this asset is already tagged on this specific page in the database
            const pageAssetKey = `${hit.page_no}_${targetAssetId}`;
            if (alreadyTaggedOnPage.has(pageAssetKey)) continue;

            // Skip duplicate matches on this page during this scan (same asset or same rectangle)
            const rectKey = `${hit.page_no}_${Math.round(hit.rect.x)}_${Math.round(hit.rect.y)}`;
            if (seenOnScan.has(pageAssetKey) || seenOnScan.has(rectKey)) continue;

            seenOnScan.add(pageAssetKey);
            seenOnScan.add(rectKey);

            matches.push({
                asset_id: targetAssetId,
                asset_name: targetAssetName,
                page_no: hit.page_no,
                rect_x: hit.rect.x,
                rect_y: hit.rect.y,
                rect_width: hit.rect.width,
                rect_height: hit.rect.height,
                matched_text: candidate.asset_name,
            });
        }
        matches.sort((a, b) => a.page_no - b.page_no || a.asset_name.localeCompare(b.asset_name));

        return NextResponse.json({ success: true, data: { matches, candidate_count: candidatesByKey.size, irrelevant_tags: irrelevantTags } });
    } catch (error: any) {
        console.error('Auto-detect error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}