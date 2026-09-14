import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/adapters';
import { isRiskMappingEditor } from '../../lib/adapters';
import { getConnection } from '../../lib/adapters';
import { retryAllFailedJobs } from '../../../../lib/jobQueue';

export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isRiskMappingEditor(session)) {
        return NextResponse.json({ success: false, error: 'Forbidden - editor role required' }, { status: 403 });
    }

    try {
        const pool = await getConnection();
        const count = await retryAllFailedJobs(pool);

        return NextResponse.json({
            success: true,
            data: {
                message: `Reset ${count} failed job(s) to PENDING`,
                count,
            },
        });
    } catch (error: any) {
        console.error('Retry all jobs error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}




