import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isRiskMappingEditor } from '@/lib/authz';
import { getConnection, sql } from '@/lib/db';
import { handleRiskMappingApiError } from '@/lib/riskMappingApiError';

// GET: the attribute display config (all rows, enabled or not - the settings
// screen needs to show disabled ones too so they can be re-enabled).
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const pool = await getConnection();
        const result = await pool.request().query('SELECT attr_key, label, order_no, is_enabled FROM dbo.rbi_pfd_tag_attribute_def ORDER BY order_no');
        return NextResponse.json({ success: true, data: result.recordset });
    } catch (error: any) {
        console.error('Tag attribute def list error:', error);
        return handleRiskMappingApiError(error, 'Tag attribute def list error');
    }
}

// PUT: bulk-update order_no/is_enabled (editor-only). Body: { items: [{ attr_key, order_no, is_enabled }] }
// This is a fixed, curated set of 5 built-in attributes - there is no create/delete,
// only reordering and enabling/disabling which of the 5 show.
export async function PUT(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isRiskMappingEditor(session)) {
        return NextResponse.json({ success: false, error: 'Forbidden - editor role required' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const items = Array.isArray(body?.items) ? body.items : null;
        if (!items || items.length === 0) {
            return NextResponse.json({ success: false, error: 'items array is required' }, { status: 400 });
        }

        const pool = await getConnection();

        // Only allow updating existing curated keys - never insert/delete rows.
        const existing = await pool.request().query('SELECT attr_key FROM dbo.rbi_pfd_tag_attribute_def');
        const validKeys = new Set(existing.recordset.map((r: any) => r.attr_key));

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            for (const item of items) {
                if (!validKeys.has(item.attr_key)) continue;
                const orderNo = parseInt(item.order_no);
                if (!Number.isFinite(orderNo)) continue;
                const req = new sql.Request(tx);
                await req
                    .input('attrKey', sql.VarChar(30), item.attr_key)
                    .input('orderNo', sql.Int, orderNo)
                    .input('isEnabled', sql.Bit, !!item.is_enabled)
                    .query('UPDATE dbo.rbi_pfd_tag_attribute_def SET order_no = @orderNo, is_enabled = @isEnabled WHERE attr_key = @attrKey');
            }
            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        return NextResponse.json({ success: true, message: 'Attribute settings updated' });
    } catch (error: any) {
        console.error('Tag attribute def update error:', error);
        return handleRiskMappingApiError(error, 'Tag attribute def update error');
    }
}