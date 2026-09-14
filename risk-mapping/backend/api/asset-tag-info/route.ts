import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTagAttributes, getSystemCardAttributes } from '@/lib/riskAttributes';

// GET: the tag-attribute payload shown on hover/click for a tagged asset -
// the 2 mandatory risk fields, plus whichever configurable attributes are
// enabled - all computed live (?asset_id=&rbim_id=&is_system=). See lib/riskAttributes.ts
// for the mandatory/configurable classification and computation logic
// (shared with the PDF export API).
export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const assetIdRaw = request.nextUrl.searchParams.get('asset_id');
    const rbimIdRaw = request.nextUrl.searchParams.get('rbim_id');
    const isSystem = request.nextUrl.searchParams.get('is_system') === 'true';
    const assetId = assetIdRaw ? parseInt(assetIdRaw) : NaN;
    const rbimId = rbimIdRaw ? parseInt(rbimIdRaw) : NaN;
    if (isNaN(assetId) || isNaN(rbimId)) {
        return NextResponse.json({ success: false, error: 'asset_id and rbim_id are required' }, { status: 400 });
    }

    try {
        const data = isSystem
            ? await getSystemCardAttributes(assetId, rbimId)
            : await getTagAttributes(assetId, rbimId);
        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Asset tag-info error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}