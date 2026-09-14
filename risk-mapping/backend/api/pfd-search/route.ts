import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getConnection, sql } from '@/lib/db';

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const pfdIdRaw = searchParams.get('pfd_id');

    if (q.length < 2) {
        return NextResponse.json({ success: false, error: 'Search query must be at least 2 characters' }, { status: 400 });
    }

    try {
        const pool = await getConnection();
        const req = pool.request().input('q', sql.NVarChar(100), q);

        let pfdFilter = '';
        if (pfdIdRaw) {
            const pfdId = parseInt(pfdIdRaw);
            if (!isNaN(pfdId)) {
                req.input('pfdId', sql.Int, pfdId);
                pfdFilter = 'AND d.pfd_id = @pfdId';
            }
        }

        const query = `
            WITH SearchHits AS (
                -- 1. Direct Mapped Tags in Drawing
                SELECT 
                    d.pfd_id,
                    d.public_id,
                    d.pfd_name,
                    d.doc_number,
                    d.drawing_revision,
                    d.drawing_title,
                    d.asset_id AS doc_asset_id,
                    da.asset_name AS doc_asset_name,
                    v.version_id,
                    v.version_no,
                    m.page_no,
                    m.asset_id AS matched_asset_id,
                    ma.asset_name AS matched_tag_name,
                    'TAG' AS match_source,
                    1 AS priority,
                    'Tagged Asset: ' + ma.asset_name + ' (#' + CAST(m.asset_id AS VARCHAR(30)) + ')' AS snippet
                FROM dbo.rbi_pfd_asset_map m
                INNER JOIN dbo.rbi_asset ma ON ma.asset_id = m.asset_id
                INNER JOIN dbo.rbi_pfd_version v ON v.version_id = m.version_id
                INNER JOIN dbo.rbi_pfd_document d ON d.pfd_id = v.pfd_id AND d.current_version_id = v.version_id AND d.is_deleted = 0
                LEFT JOIN dbo.rbi_asset da ON da.asset_id = d.asset_id
                WHERE (
                    CAST(m.asset_id AS VARCHAR(30)) = @q
                    OR ma.asset_name LIKE '%' + @q + '%'
                    OR m.matched_text LIKE '%' + @q + '%'
                )
                ${pfdFilter}

                UNION ALL

                -- 2. Child Components of Mapped Equipment Tags
                SELECT 
                    d.pfd_id,
                    d.public_id,
                    d.pfd_name,
                    d.doc_number,
                    d.drawing_revision,
                    d.drawing_title,
                    d.asset_id AS doc_asset_id,
                    da.asset_name AS doc_asset_name,
                    v.version_id,
                    v.version_no,
                    m.page_no,
                    c.asset_id AS matched_asset_id,
                    c.asset_name AS matched_tag_name,
                    'CHILD_COMPONENT' AS match_source,
                    2 AS priority,
                    'Child Component: ' + c.asset_name + ' (#' + CAST(c.asset_id AS VARCHAR(30)) + ') of ' + ma.asset_name AS snippet
                FROM dbo.rbi_pfd_asset_map m
                INNER JOIN dbo.rbi_asset ma ON ma.asset_id = m.asset_id
                INNER JOIN dbo.rbi_asset c ON c.parent_id = m.asset_id AND c.ct_id = 12
                INNER JOIN dbo.rbi_pfd_version v ON v.version_id = m.version_id
                INNER JOIN dbo.rbi_pfd_document d ON d.pfd_id = v.pfd_id AND d.current_version_id = v.version_id AND d.is_deleted = 0
                LEFT JOIN dbo.rbi_asset da ON da.asset_id = d.asset_id
                WHERE (
                    CAST(c.asset_id AS VARCHAR(30)) = @q
                    OR c.asset_name LIKE '%' + @q + '%'
                )
                AND NOT (CAST(m.asset_id AS VARCHAR(30)) = @q OR ma.asset_name LIKE '%' + @q + '%')
                ${pfdFilter}

                UNION ALL

                -- 3. Document Linked Asset or Document Metadata
                SELECT 
                    d.pfd_id,
                    d.public_id,
                    d.pfd_name,
                    d.doc_number,
                    d.drawing_revision,
                    d.drawing_title,
                    d.asset_id AS doc_asset_id,
                    da.asset_name AS doc_asset_name,
                    v.version_id,
                    v.version_no,
                    ISNULL(v.default_page, 1) AS page_no,
                    d.asset_id AS matched_asset_id,
                    da.asset_name AS matched_tag_name,
                    'DOCUMENT' AS match_source,
                    3 AS priority,
                    'Linked Drawing: ' + d.pfd_name + ISNULL(' (' + d.doc_number + ')', '') AS snippet
                FROM dbo.rbi_pfd_document d
                INNER JOIN dbo.rbi_pfd_version v ON v.version_id = d.current_version_id
                LEFT JOIN dbo.rbi_asset da ON da.asset_id = d.asset_id
                WHERE d.is_deleted = 0
                  AND (
                      CAST(d.asset_id AS VARCHAR(30)) = @q
                      OR da.asset_name LIKE '%' + @q + '%'
                      OR d.doc_number LIKE '%' + @q + '%'
                      OR d.pfd_name LIKE '%' + @q + '%'
                      OR d.drawing_title LIKE '%' + @q + '%'
                  )
                ${pfdFilter}

                UNION ALL

                -- 4. Extracted OCR / Text Layer
                SELECT 
                    d.pfd_id,
                    d.public_id,
                    d.pfd_name,
                    d.doc_number,
                    d.drawing_revision,
                    d.drawing_title,
                    d.asset_id AS doc_asset_id,
                    da.asset_name AS doc_asset_name,
                    v.version_id,
                    v.version_no,
                    t.page_no,
                    NULL AS matched_asset_id,
                    NULL AS matched_tag_name,
                    'OCR_TEXT' AS match_source,
                    4 AS priority,
                    SUBSTRING(
                        t.full_text,
                        CASE WHEN CHARINDEX(@q, t.full_text) > 20 THEN CHARINDEX(@q, t.full_text) - 20 ELSE 1 END,
                        60
                    ) AS snippet
                FROM dbo.rbi_pfd_page_text t
                INNER JOIN dbo.rbi_pfd_version v ON v.version_id = t.version_id
                INNER JOIN dbo.rbi_pfd_document d ON d.pfd_id = v.pfd_id AND d.current_version_id = v.version_id AND d.is_deleted = 0
                LEFT JOIN dbo.rbi_asset da ON da.asset_id = d.asset_id
                WHERE CHARINDEX(@q, t.full_text) > 0
                ${pfdFilter}
            ),
            DeduplicatedHits AS (
                SELECT 
                    *,
                    ROW_NUMBER() OVER (
                        PARTITION BY pfd_id, page_no, ISNULL(matched_tag_name, snippet)
                        ORDER BY priority ASC
                    ) AS rn
                FROM SearchHits
            )
            SELECT TOP 60 *
            FROM DeduplicatedHits
            WHERE rn = 1
            ORDER BY priority ASC, pfd_name ASC, page_no ASC;
        `;

        const result = await req.query(query);

        // Format clean snippets
        const results = result.recordset.map((row: any) => {
            let cleanSnippet = (row.snippet || '')
                .replace(/[\r\n\t]+/g, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim();

            if (row.match_source === 'OCR_TEXT' && cleanSnippet.length > 50) {
                cleanSnippet = cleanSnippet.slice(0, 50) + '...';
            }

            return {
                pfd_id: row.pfd_id,
                public_id: row.public_id,
                pfd_name: row.pfd_name,
                doc_number: row.doc_number,
                drawing_revision: row.drawing_revision,
                drawing_title: row.drawing_title,
                doc_asset_name: row.doc_asset_name,
                matched_asset_id: row.matched_asset_id,
                matched_tag_name: row.matched_tag_name,
                match_source: row.match_source,
                version_id: row.version_id,
                version_no: row.version_no,
                page_no: row.page_no,
                snippet: cleanSnippet,
            };
        });

        return NextResponse.json({
            success: true,
            data: {
                query: q,
                results,
                total: results.length,
            },
        });
    } catch (error: any) {
        console.error('PFD search error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Search failed' }, { status: 500 });
    }
}
