import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/adapters';
import { isRiskMappingEditor } from '../../lib/adapters';
import { getConnection, sql } from '../../lib/adapters';
import { handleRiskMappingApiError } from '../../../../lib/riskMappingApiError';

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
        const { pfd_ids } = body;

        if (!Array.isArray(pfd_ids) || pfd_ids.length === 0) {
            return NextResponse.json({ success: false, error: 'pfd_ids array is required' }, { status: 400 });
        }

        const validIds = pfd_ids
            .map((id: any) => (typeof id === 'number' ? id : parseInt(String(id), 10)))
            .filter((id: number) => !isNaN(id) && id > 0);

        if (validIds.length === 0) {
            return NextResponse.json({ success: false, error: 'No valid PFD IDs provided' }, { status: 400 });
        }

        const pool = await getConnection();
        const updatedBy = (session.user as any)?.name || session.user?.email || 'editor';

        const idListStr = validIds.join(',');
        const result = await pool
            .request()
            .input('updatedBy', sql.VarChar(50), updatedBy)
            .query(`
                UPDATE dbo.rbi_pfd_document
                SET is_deleted = 1,
                    updated_by = @updatedBy,
                    updated_at = GETDATE()
                WHERE pfd_id IN (${idListStr}) AND is_deleted = 0
            `);

        const deletedCount = result.rowsAffected?.[0] || 0;

        return NextResponse.json({
            success: true,
            message: `Deleted ${deletedCount} drawing(s)`,
            count: deletedCount,
        });
    } catch (error: any) {
        console.error('Batch delete error:', error);
        return handleRiskMappingApiError(error, 'Batch delete error');
    }
}




