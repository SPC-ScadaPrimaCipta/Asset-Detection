import { getConnection, sql } from '@/lib/db';

export interface TagAttributeValue {
    key: string;
    label: string;
    value: string | number | string[] | null;
}

export interface TagAttributes {
    asset_id: number;
    asset_description?: string | null;
    rbim_id: number;
    risk_level: string | null;
    risk_matrix_name: string | null;
    risk_rank: string | number | null;
    risk_color: string | null;
    risk_model: string | null;
    next_inspection_year: number | null;
    damage_mechanisms: string[];
    attributes: TagAttributeValue[];
}

// Only Risk Color and Risk Matrix Name are mandatory - always returned,
// never hidden, and NOT rows in rbi_pfd_tag_attribute_def (see
// sql/005_reclassify_risk_attributes.sql). Risk Level, Risk Rank, and Risk
// Model are configurable (toggle/reorder via the attribute settings screen)
// but still code-computed here (not via the generic single-table engine)
// because they require a multi-table join / a lookup keyed only by rbim_id:
//   - Risk Level: rbi_matrix_risk.description (e.g. "Medium High")
//   - Risk Matrix Name: likelihood + consequence concatenated (e.g. "2E")
//   - Risk Rank: rbi_risk.risk_overall
//   - Risk Color: rbi_matrix_risk.color
//   - Risk Model: RBI_Model.Name, keyed only by rbim_id
// Anything else found in rbi_pfd_tag_attribute_def (NEXT_INSPECTION_YEAR,
// DAMAGE_MECHANISM by default) is a DB-configured generic attribute - add a
// brand new one by inserting a DB row with
// source_table/source_column/asset_id_column/rbim_id_column populated, no
// code change needed for a plain single-table lookup.
const MANDATORY_ATTRS = [
    { key: 'RISK_MATRIX_NAME', label: 'Risk Matrix Name' },
    { key: 'RISK_COLOR', label: 'Risk Color' },
];

// Table/column identifiers can't be parameterized in T-SQL, so this is the
// defense-in-depth validation this codebase already uses elsewhere (e.g.
// save-data/route.ts) before interpolating a dynamic identifier into SQL.
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

async function runGenericAttributeQuery(
    pool: any,
    def: { source_table: string; source_column: string; asset_id_column: string; rbim_id_column: string; is_multi_row: boolean },
    assetId: number,
    rbimId: number
): Promise<any> {
    const identifiers = [def.source_table, def.source_column, def.asset_id_column, def.rbim_id_column];
    if (identifiers.some((id) => !id || !SAFE_IDENTIFIER.test(id))) {
        return null; // misconfigured row - fail closed, don't guess
    }

    const result = await pool
        .request()
        .input('assetId', sql.Int, assetId)
        .input('rbimId', sql.Int, rbimId)
        .query(`
            SELECT [${def.source_column}] AS value
            FROM dbo.[${def.source_table}]
            WHERE [${def.asset_id_column}] = @assetId AND [${def.rbim_id_column}] = @rbimId
        `);

    if (def.is_multi_row) {
        return result.recordset.map((r: any) => r.value).filter((v: any) => v != null);
    }
    return result.recordset.length > 0 ? result.recordset[0].value : null;
}

// Computes the full mandatory + configurable attribute set for one
// asset+model, live (no caching). Used by the asset-tag-info API (single
// tag, on click) and the PDF export API (looped per tagged asset on the
// selected pages).
export async function getTagAttributes(assetId: number, rbimId: number, pool?: any): Promise<TagAttributes> {
    const conn = pool || (await getConnection());

    const riskPromise = conn
        .request()
        .input('assetId', sql.Int, assetId)
        .input('rbimId', sql.Int, rbimId)
        .query(`
            SELECT mt.description AS risk_matrix_name,
                   CAST(rr.likelihood AS VARCHAR(10)) + ISNULL(rr.consequence, '') AS risk_level,
                   mr.description AS risk_rank,
                   mr.color AS risk_color
            FROM dbo.rbi_risk rr
            LEFT JOIN dbo.RBI_Model m ON m.RBIM_ID = @rbimId
            LEFT JOIN dbo.rbi_matrix_type mt ON mt.matrix_id = m.Matrix_ID
            LEFT JOIN dbo.rbi_matrix_risk mr ON mr.matrix_id = m.Matrix_ID AND mr.risk_id = rr.risk_overall
            WHERE rr.asset_id = @assetId AND rr.rbim_id = @rbimId
        `);

    // insp_year is stored as varchar; TRY_CAST guards against any
    // non-numeric values rather than erroring the whole query.
    const nextInspectionPromise = conn
        .request()
        .input('assetId', sql.Int, assetId)
        .input('rbimId', sql.Int, rbimId)
        .query(`
            SELECT
                MIN(CASE WHEN TRY_CAST(insp_year AS INT) >= YEAR(GETDATE()) THEN TRY_CAST(insp_year AS INT) END) AS next_year,
                MAX(TRY_CAST(insp_year AS INT)) AS latest_year
            FROM dbo.rbi_inspection_plan
            WHERE asset_id = @assetId AND rbim_id = @rbimId
        `);

    const damageMechanismsPromise = conn
        .request()
        .input('assetId', sql.Int, assetId)
        .input('rbimId', sql.Int, rbimId)
        .query(`
            SELECT dm.DEG_MECH
            FROM dbo.rbi_inspection_plan ip
            LEFT JOIN dbo.TIG_DEGRADATION_MECHANIS dm ON dm.DEG_MECH_ID = ip.deg_mech_id
            WHERE ip.asset_id = @assetId AND ip.rbim_id = @rbimId
        `);

    const riskModelPromise = conn
        .request()
        .input('rbimId', sql.Int, rbimId)
        .query('SELECT Name AS name FROM dbo.RBI_Model WHERE RBIM_ID = @rbimId');

    const descPromise = conn
        .request()
        .input('assetId', sql.Int, assetId)
        .query('SELECT DESCRIPTION AS description FROM dbo.CIG_HEADING WHERE Asset_ID = @assetId')
        .catch(() => ({ recordset: [] }));

    const attributeDefPromise = conn
        .request()
        .query(
            'SELECT attr_key, label, source_table, source_column, asset_id_column, rbim_id_column, is_multi_row FROM dbo.rbi_pfd_tag_attribute_def WHERE is_enabled = 1 ORDER BY order_no'
        )
        .catch(() => ({ recordset: [] }));

    const [riskResult, inspectionResult, damageResult, riskModelResult, attributeDefResult, descResult] = await Promise.all([
        riskPromise,
        nextInspectionPromise,
        damageMechanismsPromise,
        riskModelPromise,
        attributeDefPromise,
        descPromise,
    ]);

    let risk = riskResult.recordset[0] || {};
    let inspection = inspectionResult.recordset[0] || {};
    let nextInspectionYear = inspection.next_year ?? inspection.latest_year ?? null;
    let damageMechanisms = damageResult.recordset.map((r: any) => r.DEG_MECH).filter((v: any) => v != null);
    const riskModel = riskModelResult.recordset[0]?.name ?? null;
    const assetDescription = descResult.recordset[0]?.description ? String(descResult.recordset[0].description).trim() : null;

    // Fallback: If equipment has no direct risk assessment / inspection plan, roll up from child components (ct_id = 12)
    if (!risk.risk_color || nextInspectionYear == null || damageMechanisms.length === 0) {
        const childRollupPromise = conn
            .request()
            .input('assetId', sql.Int, assetId)
            .input('rbimId', sql.Int, rbimId)
            .query(`
                SELECT TOP 1
                    mr.color AS risk_color,
                    mr.description AS risk_rank,
                    CAST(r.likelihood AS VARCHAR(10)) + ISNULL(r.consequence, '') AS risk_level,
                    mt.description AS risk_matrix_name
                FROM dbo.rbi_asset c
                INNER JOIN dbo.rbi_risk r ON r.asset_id = c.asset_id AND r.rbim_id = @rbimId
                LEFT JOIN dbo.RBI_Model rm ON rm.RBIM_ID = r.rbim_id
                LEFT JOIN dbo.rbi_matrix_type mt ON mt.matrix_id = rm.Matrix_ID
                LEFT JOIN dbo.rbi_matrix_risk mr ON mr.matrix_id = rm.Matrix_ID AND mr.risk_id = r.risk_overall
                WHERE c.parent_id = @assetId AND c.ct_id = 12
                ORDER BY r.risk_overall DESC, r.consequence DESC, r.likelihood DESC;

                SELECT
                    MIN(CASE WHEN TRY_CAST(ip.insp_year AS INT) >= YEAR(GETDATE()) THEN TRY_CAST(ip.insp_year AS INT) END) AS next_year
                FROM dbo.rbi_asset c
                INNER JOIN dbo.rbi_inspection_plan ip ON ip.asset_id = c.asset_id AND ip.rbim_id = @rbimId
                WHERE c.parent_id = @assetId AND c.ct_id = 12;

                SELECT DISTINCT dm.DEG_MECH
                FROM dbo.rbi_asset c
                INNER JOIN dbo.rbi_inspection_plan ip ON ip.asset_id = c.asset_id AND ip.rbim_id = @rbimId
                LEFT JOIN dbo.TIG_DEGRADATION_MECHANIS dm ON dm.DEG_MECH_ID = ip.deg_mech_id
                WHERE c.parent_id = @assetId AND c.ct_id = 12 AND dm.DEG_MECH IS NOT NULL;
            `)
            .catch(() => null);

        const childRollup = await childRollupPromise;
        if (childRollup && childRollup.recordsets) {
            const childRisk = childRollup.recordsets[0]?.[0];
            const childInsp = childRollup.recordsets[1]?.[0];
            const childDmg = childRollup.recordsets[2]?.map((r: any) => r.DEG_MECH).filter((v: any) => v != null) || [];

            if (!risk.risk_color && childRisk) {
                risk = {
                    risk_matrix_name: childRisk.risk_matrix_name ?? null,
                    risk_level: childRisk.risk_level ?? null,
                    risk_rank: childRisk.risk_rank ?? null,
                    risk_color: childRisk.risk_color ?? null,
                };
            }
            if (nextInspectionYear == null && childInsp?.next_year != null) {
                nextInspectionYear = childInsp.next_year;
            }
            if (damageMechanisms.length === 0 && childDmg.length > 0) {
                damageMechanisms = childDmg;
            }
        }
    }

    const mandatoryValues: Record<string, any> = {
        RISK_MATRIX_NAME: risk.risk_matrix_name ?? null,
        RISK_COLOR: risk.risk_color ?? null,
    };

    // Mandatory attributes always come first, unconditionally - not
    // gated by rbi_pfd_tag_attribute_def at all.
    const mandatoryAttributes = MANDATORY_ATTRS.map((a) => ({ key: a.key, label: a.label, value: mandatoryValues[a.key] }));

    // Configurable attributes: these use values already computed above;
    // anything else is a DB-configured generic attribute, queried
    // dynamically.
    const configuredValues: Record<string, any> = {
        NEXT_INSPECTION_YEAR: nextInspectionYear,
        DAMAGE_MECHANISM: damageMechanisms,
        RISK_LEVEL: risk.risk_level ?? null,
        RISK_RANK: risk.risk_rank ?? null,
        RISK_MODEL: riskModel,
    };
    const configurableAttributes = await Promise.all(
        attributeDefResult.recordset.map(async (def: any) => {
            const value = def.attr_key in configuredValues ? configuredValues[def.attr_key] : await runGenericAttributeQuery(conn, def, assetId, rbimId);
            return { key: def.attr_key, label: def.label, value };
        })
    );

    return {
        asset_id: assetId,
        asset_description: assetDescription || null,
        rbim_id: rbimId,
        risk_level: risk.risk_level ?? null,
        risk_matrix_name: risk.risk_matrix_name ?? null,
        risk_rank: risk.risk_rank ?? null,
        risk_color: risk.risk_color ?? null,
        risk_model: riskModel,
        next_inspection_year: nextInspectionYear,
        damage_mechanisms: damageMechanisms,
        attributes: [...mandatoryAttributes, ...configurableAttributes],
    };
}

/**
 * Computes attributes specifically for a System Summary Risk Card,
 * aggregating earliest future inspection year and distinct degradation mechanisms
 * across the system asset and all its physical descendants.
 *
 * Uses cycle-safe path tracking in the recursive CTE.
 * Does NOT alter getTagAttributes() to ensure single-asset sidebar inspection
 * drawer semantics remain strictly untouched.
 */
export async function getSystemCardAttributes(assetId: number, rbimId: number, pool?: any): Promise<TagAttributes> {
    const conn = pool || (await getConnection());

    // 1. Get base single-asset attributes (risk level, rank, matrix, color, model)
    const baseAttrs = await getTagAttributes(assetId, rbimId, conn);

    // If this system asset does not have direct risk in the selected model,
    // inherit risk from its nearest ancestor (e.g. Area, Unit, or Plant)
    if (!baseAttrs.risk_level && !baseAttrs.risk_color) {
        try {
            const inheritedRiskRes = await conn
                .request()
                .input('assetId', sql.Int, assetId)
                .input('rbimId', sql.Int, rbimId)
                .query(`
                    WITH Ancestors AS (
                        SELECT asset_id, parent_id, 0 as depth, CAST('/' + CAST(asset_id AS varchar(20)) + '/' AS varchar(500)) as path
                        FROM dbo.rbi_asset WHERE asset_id = @assetId
                        UNION ALL
                        SELECT p.asset_id, p.parent_id, a.depth + 1, CAST(a.path + CAST(p.asset_id AS varchar(20)) + '/' AS varchar(500))
                        FROM Ancestors a
                        INNER JOIN dbo.rbi_asset p ON p.asset_id = a.parent_id
                        WHERE a.path NOT LIKE '%/' + CAST(p.asset_id AS varchar(20)) + '/%'
                    )
                    SELECT TOP 1
                        mr.color AS inherited_color,
                        mr.description AS inherited_risk_rank,
                        CAST(r.likelihood AS VARCHAR(10)) + ISNULL(r.consequence, '') AS inherited_risk_level,
                        mt.description AS risk_matrix_name
                    FROM Ancestors a
                    INNER JOIN dbo.rbi_risk r ON r.asset_id = a.asset_id AND r.rbim_id = @rbimId
                    LEFT JOIN dbo.RBI_Model rm ON rm.RBIM_ID = r.rbim_id
                    LEFT JOIN dbo.rbi_matrix_type mt ON mt.matrix_id = rm.Matrix_ID
                    LEFT JOIN dbo.rbi_matrix_risk mr ON mr.matrix_id = rm.Matrix_ID AND mr.risk_id = r.risk_overall
                    WHERE a.depth > 0
                    ORDER BY a.depth ASC
                `);
            if (inheritedRiskRes.recordset.length > 0) {
                const row = inheritedRiskRes.recordset[0];
                baseAttrs.risk_level = row.inherited_risk_level ?? null;
                baseAttrs.risk_color = row.inherited_color ?? null;
                baseAttrs.risk_rank = row.inherited_risk_rank ?? null;
                baseAttrs.risk_matrix_name = row.risk_matrix_name ?? null;

                baseAttrs.attributes = baseAttrs.attributes.map((attr) => {
                    if (attr.key === 'RISK_LEVEL') return { ...attr, value: baseAttrs.risk_level };
                    if (attr.key === 'RISK_COLOR') return { ...attr, value: baseAttrs.risk_color };
                    if (attr.key === 'RISK_RANK') return { ...attr, value: baseAttrs.risk_rank };
                    if (attr.key === 'RISK_MATRIX_NAME') return { ...attr, value: baseAttrs.risk_matrix_name };
                    return attr;
                });
            }
        } catch (err) {
            console.error('Error resolving inherited risk for system card:', err);
        }
    }

    // 2. Query descendant earliest future inspection year (cycle-safe)
    const inspectionPromise = conn
        .request()
        .input('assetId', sql.Int, assetId)
        .input('rbimId', sql.Int, rbimId)
        .query(`
            WITH TargetAndDescendants AS (
                SELECT
                    asset_id,
                    0 AS depth,
                    CAST('/' + CAST(asset_id AS varchar(20)) + '/' AS varchar(500)) AS path
                FROM dbo.rbi_asset
                WHERE asset_id = @assetId

                UNION ALL

                SELECT
                    a.asset_id,
                    td.depth + 1,
                    CAST(td.path + CAST(a.asset_id AS varchar(20)) + '/' AS varchar(500))
                FROM dbo.rbi_asset a
                JOIN TargetAndDescendants td
                    ON a.parent_id = td.asset_id
                WHERE td.path NOT LIKE '%/' + CAST(a.asset_id AS varchar(20)) + '/%'
            )
            SELECT
                MIN(CASE WHEN TRY_CAST(insp_year AS INT) >= YEAR(GETDATE()) THEN TRY_CAST(insp_year AS INT) END) AS next_year
            FROM dbo.rbi_inspection_plan
            WHERE asset_id IN (SELECT asset_id FROM TargetAndDescendants)
              AND rbim_id = @rbimId
            OPTION (MAXRECURSION 20)
        `);

    // 3. Query descendant distinct degradation mechanisms (cycle-safe)
    const damagePromise = conn
        .request()
        .input('assetId', sql.Int, assetId)
        .input('rbimId', sql.Int, rbimId)
        .query(`
            WITH TargetAndDescendants AS (
                SELECT
                    asset_id,
                    0 AS depth,
                    CAST('/' + CAST(asset_id AS varchar(20)) + '/' AS varchar(500)) AS path
                FROM dbo.rbi_asset
                WHERE asset_id = @assetId

                UNION ALL

                SELECT
                    a.asset_id,
                    td.depth + 1,
                    CAST(td.path + CAST(a.asset_id AS varchar(20)) + '/' AS varchar(500))
                FROM dbo.rbi_asset a
                JOIN TargetAndDescendants td
                    ON a.parent_id = td.asset_id
                WHERE td.path NOT LIKE '%/' + CAST(a.asset_id AS varchar(20)) + '/%'
            )
            SELECT DISTINCT dm.DEG_MECH
            FROM dbo.rbi_inspection_plan ip
            LEFT JOIN dbo.TIG_DEGRADATION_MECHANIS dm ON dm.DEG_MECH_ID = ip.deg_mech_id
            WHERE ip.asset_id IN (SELECT asset_id FROM TargetAndDescendants)
              AND ip.rbim_id = @rbimId
              AND dm.DEG_MECH IS NOT NULL
            OPTION (MAXRECURSION 20)
        `);

    const [inspResult, damageResult] = await Promise.all([inspectionPromise, damagePromise]);

    const nextInspectionYear: number | null = inspResult.recordset[0]?.next_year ?? null;
    const damageMechanisms: string[] = damageResult.recordset
        .map((r: any) => r.DEG_MECH)
        .filter((v: any) => v != null);

    // Update attributes list for NEXT_INSPECTION_YEAR and DAMAGE_MECHANISM
    const updatedAttributes = baseAttrs.attributes.map((attr) => {
        if (attr.key === 'NEXT_INSPECTION_YEAR') {
            return { ...attr, value: nextInspectionYear };
        }
        if (attr.key === 'DAMAGE_MECHANISM') {
            return { ...attr, value: damageMechanisms };
        }
        return attr;
    });

    return {
        ...baseAttrs,
        next_inspection_year: nextInspectionYear,
        damage_mechanisms: damageMechanisms,
        attributes: updatedAttributes,
    };
}