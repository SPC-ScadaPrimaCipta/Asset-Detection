import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/adapters';
import { getConnection } from '../../lib/adapters';
import { getRecentJobs, getWorkerStatus } from '../../../lib/jobQueue';

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    try {
        const pool = await getConnection();
        const [jobs, worker] = await Promise.all([
            getRecentJobs(limit, pool),
            getWorkerStatus(pool),
        ]);

        return NextResponse.json({
            success: true,
            data: jobs,
            worker,
        });
    } catch (error: any) {
        console.error('Fetch jobs error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}



