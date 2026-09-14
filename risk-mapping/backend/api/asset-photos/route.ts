import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/adapters';
import { isRiskMappingEditor } from '../../lib/adapters';
import { getConnection, sql } from '../../lib/adapters';
import { saveAssetPhoto } from '../../../lib/assetPhotoStorage';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PHOTOS_PER_ASSET = 20;

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const assetIdRaw = searchParams.get('asset_id');
    const assetId = assetIdRaw ? parseInt(assetIdRaw) : NaN;
    if (isNaN(assetId)) {
        return NextResponse.json({ success: false, error: 'Valid asset_id is required' }, { status: 400 });
    }

    try {
        const pool = await getConnection();
        const result = await pool
            .request()
            .input('assetId', sql.Int, assetId)
            .query(`
                SELECT photo_id, asset_id, file_name, file_size, mime_type, caption, taken_at, uploaded_by, uploaded_at
                FROM dbo.rbi_asset_photo
                WHERE asset_id = @assetId AND is_deleted = 0
                ORDER BY uploaded_at DESC
            `);

        return NextResponse.json({
            success: true,
            data: result.recordset,
        });
    } catch (error: any) {
        console.error('Fetch asset photos error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isRiskMappingEditor(session)) {
        return NextResponse.json({ success: false, error: 'Forbidden - editor role required' }, { status: 403 });
    }

    try {
        const formData = await request.formData();
        const assetIdRaw = formData.get('asset_id');
        const assetId = assetIdRaw ? parseInt(String(assetIdRaw)) : NaN;
        if (isNaN(assetId)) {
            return NextResponse.json({ success: false, error: 'Valid asset_id is required' }, { status: 400 });
        }

        const file = formData.get('file') as File | null;
        if (!file) {
            return NextResponse.json({ success: false, error: 'Image file is required' }, { status: 400 });
        }

        // Server-side size validation
        if (file.size > MAX_FILE_SIZE_BYTES) {
            return NextResponse.json(
                { success: false, error: `Photo exceeds maximum allowed size of 10 MB (was ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
                { status: 400 }
            );
        }

        // Server-side MIME validation
        const mimeType = file.type?.toLowerCase() || 'image/jpeg';
        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
            return NextResponse.json(
                { success: false, error: `Invalid image type '${mimeType}'. Allowed formats: JPEG, PNG, WebP` },
                { status: 400 }
            );
        }

        const captionRaw = formData.get('caption');
        const caption = captionRaw ? String(captionRaw).trim() : null;

        const takenAtRaw = formData.get('taken_at');
        let takenAt: Date | null = null;
        if (takenAtRaw) {
            const parsedDate = new Date(String(takenAtRaw));
            if (!isNaN(parsedDate.getTime())) {
                takenAt = parsedDate;
            }
        }

        const pool = await getConnection();

        // Validate asset exists
        const assetCheck = await pool
            .request()
            .input('assetId', sql.Int, assetId)
            .query('SELECT asset_id FROM dbo.rbi_asset WHERE asset_id = @assetId');
        if (assetCheck.recordset.length === 0) {
            return NextResponse.json({ success: false, error: 'asset_id does not exist' }, { status: 400 });
        }

        // Enforce max photos limit per asset
        const countCheck = await pool
            .request()
            .input('assetId', sql.Int, assetId)
            .query('SELECT COUNT(*) AS total FROM dbo.rbi_asset_photo WHERE asset_id = @assetId AND is_deleted = 0');
        if ((countCheck.recordset[0]?.total || 0) >= MAX_PHOTOS_PER_ASSET) {
            return NextResponse.json(
                { success: false, error: `Asset #${assetId} has reached the maximum of ${MAX_PHOTOS_PER_ASSET} photos.` },
                { status: 400 }
            );
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const uploadedBy = (session.user as any)?.name || session.user?.email || 'editor';

        // Persist image file
        const { relPath, safeName } = await saveAssetPhoto(assetId, file.name, buffer, mimeType);

        // Insert database record
        const insertResult = await pool
            .request()
            .input('assetId', sql.Int, assetId)
            .input('fileName', sql.NVarChar(260), safeName)
            .input('filePath', sql.NVarChar(500), relPath)
            .input('fileSize', sql.BigInt, buffer.length)
            .input('mimeType', sql.VarChar(50), mimeType)
            .input('caption', sql.NVarChar(500), caption)
            .input('takenAt', sql.DateTime, takenAt)
            .input('uploadedBy', sql.VarChar(50), uploadedBy)
            .query(`
                INSERT INTO dbo.rbi_asset_photo (asset_id, file_name, file_path, file_size, mime_type, caption, taken_at, uploaded_by)
                OUTPUT INSERTED.photo_id, INSERTED.uploaded_at
                VALUES (@assetId, @fileName, @filePath, @fileSize, @mimeType, @caption, @takenAt, @uploadedBy)
            `);

        const created = insertResult.recordset[0];

        return NextResponse.json(
            {
                success: true,
                data: {
                    photo_id: created.photo_id,
                    asset_id: assetId,
                    file_name: safeName,
                    file_size: buffer.length,
                    mime_type: mimeType,
                    caption,
                    taken_at: takenAt,
                    uploaded_by: uploadedBy,
                    uploaded_at: created.uploaded_at,
                },
            },
            { status: 201 }
        );
    } catch (error: any) {
        console.error('Upload asset photo error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}




