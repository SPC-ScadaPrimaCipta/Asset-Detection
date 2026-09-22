/**
 * Company Knowledge DB — Hierarchical
 *
 * Lookup priority: most specific → least specific
 *   1. project_id + drawing_type + tag_prefix
 *   2. project_id + tag_prefix
 *   3. project_id only
 *   4. global (project_id IS NULL)
 *   5. ISA/ISO (handled by rule-validator, not here)
 */

import { pool } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export interface CompanyKnowledge {
  id: string;
  project_id: string | null;
  drawing_type: string | null;       // e.g. 'P&ID', 'PFD', 'ISOMETRIC'
  tag_prefix: string | null;
  asset_type: string;
  asset_name: string;
  category: string | null;
  symbol_description: string | null;
  geometry_hints: Record<string, unknown> | null;
  source_detection_id: string | null;
  confirmed_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Hierarchical lookup — most specific match returned first.
 *
 * Hierarchy:
 *   Level 1: project + drawing_type + tag_prefix (exact)
 *   Level 2: project + tag_prefix (any drawing type)
 *   Level 3: project only (any tag prefix, fuzzy asset_type match)
 *   Level 4: global (project_id IS NULL)
 *
 * Returns first non-empty result set.
 */
export async function lookupCompanyKnowledge(opts: {
  tagPrefix?: string | null;
  assetType?: string | null;
  projectId?: string | null;
  drawingType?: string | null;
}): Promise<CompanyKnowledge[]> {
  const { tagPrefix, assetType, projectId, drawingType } = opts;
  if (!tagPrefix && !assetType) return [];

  const tagCond = tagPrefix ? `AND UPPER(tag_prefix) = UPPER($TAG_PREFIX)` : '';
  const typeCond = assetType ? `AND LOWER(asset_type) LIKE LOWER($ASSET_TYPE)` : '';

  // Helper: run query with param substitution
  async function run(
    extraCond: string,
    extraParams: Record<string, unknown>
  ): Promise<CompanyKnowledge[]> {
    let sql = `SELECT * FROM company_knowledge WHERE 1=1 ${tagCond} ${typeCond} ${extraCond} ORDER BY confirmed_count DESC, updated_at DESC LIMIT 10`;
    const params: unknown[] = [];
    let idx = 1;

    // Replace named placeholders
    if (tagPrefix) {
      sql = sql.replace('$TAG_PREFIX', `$${idx++}`);
      params.push(tagPrefix);
    } else {
      sql = sql.replace('$TAG_PREFIX', '');
    }
    if (assetType) {
      sql = sql.replace('$ASSET_TYPE', `$${idx++}`);
      params.push(`%${assetType}%`);
    } else {
      sql = sql.replace('$ASSET_TYPE', '');
    }

    // Replace extra condition placeholders
    for (const [key, val] of Object.entries(extraParams)) {
      sql = sql.replace(`$${key}`, `$${idx++}`);
      params.push(val);
    }

    const r = await pool.query(sql, params);
    return r.rows as CompanyKnowledge[];
  }

  // Level 1: project + drawing_type + tag_prefix
  if (projectId && drawingType) {
    const r = await run(
      `AND project_id=$PROJECT AND LOWER(drawing_type)=LOWER($DRAWING)`,
      { PROJECT: projectId, DRAWING: drawingType }
    );
    if (r.length) return r;
  }

  // Level 2: project + tag_prefix
  if (projectId) {
    const r = await run(`AND project_id=$PROJECT`, { PROJECT: projectId });
    if (r.length) return r;
  }

  // Level 3: global
  const r = await run(`AND project_id IS NULL`, {});
  return r;
}

/**
 * Save or upsert company knowledge.
 * If same tag_prefix + asset_type + project_id + drawing_type exists → increment confirmed_count.
 */
export async function saveCompanyKnowledge(
  entry: Omit<CompanyKnowledge, 'id' | 'confirmed_count' | 'created_at' | 'updated_at'>
): Promise<CompanyKnowledge> {
  const {
    project_id, drawing_type, tag_prefix, asset_type, asset_name,
    category, symbol_description, geometry_hints, source_detection_id,
  } = entry;

  const existing = await pool.query(
    `SELECT * FROM company_knowledge
     WHERE UPPER(COALESCE(tag_prefix,'')) = UPPER(COALESCE($1,''))
       AND LOWER(asset_type) = LOWER($2)
       AND ($3::uuid IS NULL AND project_id IS NULL OR project_id = $3::uuid)
       AND ($4 IS NULL AND drawing_type IS NULL OR LOWER(drawing_type) = LOWER($4))
     LIMIT 1`,
    [tag_prefix ?? '', asset_type, project_id ?? null, drawing_type ?? null]
  );

  if (existing.rows.length > 0) {
    const updated = await pool.query(
      `UPDATE company_knowledge SET
         confirmed_count = confirmed_count + 1,
         asset_name = $1,
         category = COALESCE($2, category),
         symbol_description = COALESCE($3, symbol_description),
         geometry_hints = COALESCE($4, geometry_hints),
         source_detection_id = COALESCE($5, source_detection_id),
         updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        asset_name, category ?? null,
        symbol_description ?? null,
        geometry_hints ? JSON.stringify(geometry_hints) : null,
        source_detection_id ?? null,
        existing.rows[0].id,
      ]
    );
    return updated.rows[0] as CompanyKnowledge;
  }

  const inserted = await pool.query(
    `INSERT INTO company_knowledge
       (project_id, drawing_type, tag_prefix, asset_type, asset_name,
        category, symbol_description, geometry_hints, source_detection_id, confirmed_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
     RETURNING *`,
    [
      project_id ?? null, drawing_type ?? null, tag_prefix ?? null,
      asset_type, asset_name, category ?? null,
      symbol_description ?? null,
      geometry_hints ? JSON.stringify(geometry_hints) : null,
      source_detection_id ?? null,
    ]
  );
  return inserted.rows[0] as CompanyKnowledge;
}

export async function getProjectKnowledge(projectId: string): Promise<CompanyKnowledge[]> {
  const result = await pool.query(
    `SELECT * FROM company_knowledge
     WHERE project_id = $1 OR project_id IS NULL
     ORDER BY confirmed_count DESC, asset_type ASC`,
    [projectId]
  );
  return result.rows as CompanyKnowledge[];
}

export async function getAllKnowledge(): Promise<CompanyKnowledge[]> {
  const result = await pool.query(
    `SELECT ck.*, p.name as project_name
     FROM company_knowledge ck
     LEFT JOIN projects p ON p.id = ck.project_id
     ORDER BY ck.confirmed_count DESC, ck.asset_type ASC`
  );
  return result.rows as CompanyKnowledge[];
}

export async function deleteKnowledge(id: string): Promise<void> {
  await pool.query('DELETE FROM company_knowledge WHERE id = $1', [id]);
}

export async function updateKnowledge(
  id: string,
  fields: Partial<Pick<CompanyKnowledge, 'asset_type' | 'asset_name' | 'category' | 'symbol_description' | 'tag_prefix' | 'drawing_type'>>
): Promise<CompanyKnowledge | null> {
  const allowed = ['asset_type', 'asset_name', 'category', 'symbol_description', 'tag_prefix', 'drawing_type'] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k}=$${i++}`); vals.push(fields[k]); }
  }
  if (!sets.length) return null;
  sets.push(`updated_at=NOW()`);
  vals.push(id);
  const result = await pool.query(
    `UPDATE company_knowledge SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, vals
  );
  return result.rows[0] ?? null;
}
