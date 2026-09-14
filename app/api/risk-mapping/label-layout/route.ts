import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/adapters';
import { getConnection, sql } from '../../lib/adapters';
import { handleRiskMappingApiError } from '../../../lib/riskMappingApiError';

interface LayoutItem {
    map_id: number;
    rbim_id: number;
    layout_x: number;
    layout_y: number;
    box_width?: number | null;
    label_scale?: number | null;
}

// POST: save/upsert label layout coordinates for one or more tags under a specific risk model
// Body: { items: [{ map_id, rbim_id, layout_x, layout_y, box_width, label_scale }] } OR { map_id, rbim_id, layout_x, layout_y, box_width, label_scale }
export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        let items: LayoutItem[] = [];

        if (Array.isArray(body?.items)) {
            items = body.items;
        } else if (body?.map_id && body?.rbim_id) {
            items = [{
                map_id: parseInt(body.map_id),
                rbim_id: parseInt(body.rbim_id),
                layout_x: parseFloat(body.layout_x),
                layout_y: parseFloat(body.layout_y),
                box_width: body.box_width != null ? parseFloat(body.box_width) : null,
                label_scale: body.label_scale != null ? parseFloat(body.label_scale) : null,
            }];
        }

        if (items.length === 0) {
            return NextResponse.json({ success: false, error: 'No layout items provided' }, { status: 400 });
        }

        for (const item of items) {
            if (isNaN(item.map_id) || isNaN(item.rbim_id)) {
                return NextResponse.json({ success: false, error: 'map_id and rbim_id must be valid numbers' }, { status: 400 });
            }
            if (typeof item.layout_x !== 'number' || !Number.isFinite(item.layout_x) ||
                typeof item.layout_y !== 'number' || !Number.isFinite(item.layout_y)) {
                return NextResponse.json({ success: false, error: 'layout_x and layout_y must be valid numbers' }, { status: 400 });
            }
        }

        const pool = await getConnection();
        const savedBy = (session.user as any)?.name || session.user?.email || 'unknown';

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            for (const item of items) {
                const boxWidth = typeof item.box_width === 'number' && Number.isFinite(item.box_width) ? item.box_width : null;
                const labelScale = typeof item.label_scale === 'number' && Number.isFinite(item.label_scale) ? item.label_scale : null;
                const req = new sql.Request(tx);
                req
                    .input('mapId', sql.Int, item.map_id)
                    .input('rbimId', sql.Int, item.rbim_id)
                    .input('layoutX', sql.Float, Math.max(0, Math.min(100, item.layout_x)))
                    .input('layoutY', sql.Float, Math.max(0, Math.min(100, item.layout_y)))
                    .input('boxWidth', sql.Float, boxWidth)
                    .input('labelScale', sql.Float, labelScale)
                    .input('savedBy', sql.VarChar(50), savedBy);
                await req.query(`
                        MERGE dbo.rbi_pfd_label_layout AS target
                        USING (VALUES (@mapId, @rbimId, @layoutX, @layoutY, @boxWidth, @labelScale, @savedBy))
                            AS source (map_id, rbim_id, layout_x, layout_y, box_width, label_scale, saved_by)
                        ON (target.map_id = source.map_id AND target.rbim_id = source.rbim_id)
                        WHEN MATCHED THEN
                            UPDATE SET target.layout_x    = source.layout_x,
                                       target.layout_y    = source.layout_y,
                                       target.box_width   = source.box_width,
                                       target.label_scale = source.label_scale,
                                       target.saved_by    = source.saved_by,
                                       target.saved_at    = GETDATE()
                        WHEN NOT MATCHED THEN
                            INSERT (map_id, rbim_id, layout_x, layout_y, box_width, label_scale, saved_by)
                            VALUES (source.map_id, source.rbim_id, source.layout_x, source.layout_y, source.box_width, source.label_scale, source.saved_by);
                    `);
            }
            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        return NextResponse.json({ success: true, message: `Saved ${items.length} label layout item(s)` });
    } catch (error: any) {
        console.error('Label layout save error:', error);
        return handleRiskMappingApiError(error, 'Label layout save error');
    }
}

// DELETE: reset/remove custom label layout (?map_id=&rbim_id= OR ?version_id=&rbim_id=)
export async function DELETE(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const searchParams = request.nextUrl.searchParams;
        const mapIdRaw = searchParams.get('map_id');
        const versionIdRaw = searchParams.get('version_id');
        const rbimIdRaw = searchParams.get('rbim_id');

        const rbimId = rbimIdRaw ? parseInt(rbimIdRaw) : NaN;
        if (isNaN(rbimId)) {
            return NextResponse.json({ success: false, error: 'rbim_id is required' }, { status: 400 });
        }

        const pool = await getConnection();
        const req = pool.request().input('rbimId', sql.Int, rbimId);

        if (mapIdRaw) {
            const mapId = parseInt(mapIdRaw);
            if (isNaN(mapId)) {
                return NextResponse.json({ success: false, error: 'map_id must be a number' }, { status: 400 });
            }
            req.input('mapId', sql.Int, mapId);
            await req.query('DELETE FROM dbo.rbi_pfd_label_layout WHERE map_id = @mapId AND rbim_id = @rbimId');
        } else if (versionIdRaw) {
            const versionId = parseInt(versionIdRaw);
            if (isNaN(versionId)) {
                return NextResponse.json({ success: false, error: 'version_id must be a number' }, { status: 400 });
            }
            req.input('versionId', sql.Int, versionId);
            await req.query(`
                DELETE ll
                FROM dbo.rbi_pfd_label_layout ll
                INNER JOIN dbo.rbi_pfd_asset_map m ON m.map_id = ll.map_id
                WHERE m.version_id = @versionId AND ll.rbim_id = @rbimId
            `);
        } else {
            return NextResponse.json({ success: false, error: 'Either map_id or version_id is required' }, { status: 400 });
        }

        return NextResponse.json({ success: true, message: 'Label layout reset' });
    } catch (error: any) {
        console.error('Label layout reset error:', error);
        return handleRiskMappingApiError(error, 'Label layout reset error');
    }
}



