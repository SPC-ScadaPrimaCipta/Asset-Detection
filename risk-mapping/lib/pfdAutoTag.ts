import { sql } from './db';
import { readPfdFile } from './pfdStorage';
import { searchPdfText } from './pdfRender';

export interface AutoTagResult {
    versionId: number;
    candidateCount: number;
    matchesFound: number;
    tagsCreated: number;
    tagsRemoved: number;
}

export function getCandidateVariants(name: string, ct_id?: number | null): string[] {
    const variants = new Set<string>();
    const trimmed = (name || '').trim();
    if (trimmed.length >= 2) variants.add(trimmed);

    // If System (9, 16) or Unit Equipment/Piping (21, 22)
    if (ct_id && [9, 16, 21, 22].includes(ct_id)) {
        // Strip leading numbering like '10. ', '01. ', '2E10. '
        const withoutNum = trimmed.replace(/^([0-9]+|[0-9]+[A-Za-z]+[0-9]*)\.\s*/i, '').trim();
        if (withoutNum.length >= 3) variants.add(withoutNum);

        // Strip trailing 'SYSTEM PIPING', 'SYSTEM', 'PIPING'
        const base = withoutNum.replace(/\s+(SYSTEM\s+PIPING|SYSTEM|PIPING)$/i, '').trim();
        if (base.length >= 3) variants.add(base);
    }
    return Array.from(variants);
}

/**
 * Scans a PFD drawing for asset tags belonging to rootAssetId hierarchy,
 * and automatically commits them to dbo.rbi_pfd_asset_map with detection_mode='AUTO'.
 */
export async function executeAutoDetectAndTag(
    versionId: number,
    rootAssetId: number,
    createdBy: string,
    pool: any,
    onProgress?: (pct: number, message: string) => Promise<void>
): Promise<AutoTagResult> {
    if (onProgress) await onProgress(10, 'Locating drawing file and linked assets');

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
        throw new Error(`PFD version #${versionId} does not exist`);
    }

    const { file_path: filePath, root_asset_id: docAssetId } = versionResult.recordset[0];
    const effectiveRootId = rootAssetId || docAssetId;

    if (onProgress) await onProgress(20, 'Querying asset hierarchy candidate tags');

    // Recursive descendants of effectiveRootId
    const candidatesResult = await pool
        .request()
        .input('assetId', sql.Int, effectiveRootId)
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
            SELECT ah.asset_id, ah.parent_id, ah.ct_id, ah.asset_name, pa.ct_id AS parent_ct_id
            FROM AssetHierarchy ah
            LEFT JOIN dbo.rbi_asset pa ON pa.asset_id = ah.parent_id
        `);

    // Prune irrelevant tags: delete any existing tags on this version
    // whose asset_id does NOT belong to the candidate hierarchy (effectiveRootId and descendants)
    let tagsRemoved = 0;
    const pruneResult = await pool
        .request()
        .input('versionId', sql.Int, versionId)
        .input('assetId', sql.Int, effectiveRootId)
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
            DELETE FROM dbo.rbi_pfd_asset_map
            WHERE version_id = @versionId
              AND asset_id NOT IN (SELECT asset_id FROM AssetHierarchy);
        `);
    tagsRemoved = pruneResult.rowsAffected[0] || 0;

    if (tagsRemoved > 0 && onProgress) {
        await onProgress(25, `Removed ${tagsRemoved} irrelevant tag(s) outside asset hierarchy`);
    }

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
        return { versionId, candidateCount: 0, matchesFound: 0, tagsCreated: 0, tagsRemoved };
    }

    if (onProgress) await onProgress(40, `Scanning PDF vector text for ${candidatesByKey.size} candidate tags`);

    const buffer = await readPfdFile(filePath);
    const needles: { key: string; text: string }[] = [];
    candidatesByKey.forEach((c, key) => {
        const variants = getCandidateVariants(c.asset_name, c.ct_id);
        for (let i = 0; i < variants.length; i++) {
            needles.push({ key, text: variants[i] });
        }
    });
    const hits = await searchPdfText(buffer, needles);

    if (hits.length === 0) {
        return { versionId, candidateCount: candidatesByKey.size, matchesFound: 0, tagsCreated: 0, tagsRemoved };
    }

    if (onProgress) await onProgress(70, `Mapping ${hits.length} detected tag(s) into drawing`);

    const seenOnScan = new Set<string>();
    let tagsCreated = 0;
    for (const hit of hits) {
        const candidate = candidatesByKey.get(hit.key);
        if (!candidate) continue;

        const isTitleBlockZone = hit.rect.x > 70 && hit.rect.y > 75;
        const isChildPipingEquipment = (candidate.ct_id === 21 || candidate.ct_id === 22) && candidate.parent_ct_id === 9;
        const targetAssetId = isTitleBlockZone && isChildPipingEquipment && candidate.parent_id ? candidate.parent_id : candidate.asset_id;

        const pageAssetKey = `${hit.page_no}_${targetAssetId}`;
        if (alreadyTaggedOnPage.has(pageAssetKey)) continue;

        const rectKey = `${hit.page_no}_${Math.round(hit.rect.x)}_${Math.round(hit.rect.y)}`;
        if (seenOnScan.has(pageAssetKey) || seenOnScan.has(rectKey)) continue;

        seenOnScan.add(pageAssetKey);
        seenOnScan.add(rectKey);
        alreadyTaggedOnPage.add(pageAssetKey);

        try {
            await pool
                .request()
                .input('versionId', sql.Int, versionId)
                .input('assetId', sql.Int, targetAssetId)
                .input('pageNo', sql.Int, hit.page_no)
                .input('rectX', sql.Float, hit.rect.x)
                .input('rectY', sql.Float, hit.rect.y)
                .input('rectWidth', sql.Float, hit.rect.width)
                .input('rectHeight', sql.Float, hit.rect.height)
                .input('matchedText', sql.NVarChar(200), candidate.asset_name)
                .input('createdBy', sql.VarChar(50), createdBy || 'auto-tagger')
                .query(`
                    INSERT INTO dbo.rbi_pfd_asset_map (
                        version_id, asset_id, page_no,
                        rect_x, rect_y, rect_width, rect_height,
                        matched_text, detection_mode, created_by
                    )
                    VALUES (
                        @versionId, @assetId, @pageNo,
                        @rectX, @rectY, @rectWidth, @rectHeight,
                        @matchedText, 'AUTO', @createdBy
                    )
                `);
            tagsCreated++;
        } catch (insertErr) {
            console.warn(`Failed to insert auto-mapped tag for asset #${candidate.asset_id}:`, insertErr);
        }
    }

    return {
        versionId,
        candidateCount: candidatesByKey.size,
        matchesFound: hits.length,
        tagsCreated,
        tagsRemoved,
    };
}
