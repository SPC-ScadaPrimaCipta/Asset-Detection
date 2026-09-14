import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isRiskMappingEditor } from '@/lib/authz';
import { backfillDefaultPages } from '@/scripts/backfill-default-pages';
import { handleRiskMappingApiError } from '@/lib/riskMappingApiError';

export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isRiskMappingEditor(session)) {
        return NextResponse.json({ success: false, error: 'Forbidden - editor role required' }, { status: 403 });
    }

    try {
        const result = await backfillDefaultPages();
        return NextResponse.json({
            success: true,
            data: result,
            message: `Synced default pages: ${result.updated} updated, ${result.unchanged} already correct.`,
        });
    } catch (error: any) {
        console.error('Error syncing default pages:', error);
        return handleRiskMappingApiError(error, 'Failed to sync default pages');
    }
}
