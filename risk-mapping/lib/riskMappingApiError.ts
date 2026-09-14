import { NextResponse } from 'next/server';

export function handleRiskMappingApiError(error: unknown, defaultMessage = 'Internal Server Error') {
    const message = error instanceof Error ? error.message : String(error || defaultMessage);

    const lower = message.toLowerCase();
    if (lower.includes('invalid object name') && lower.includes('rbi_pfd')) {
        return NextResponse.json(
            {
                success: false,
                error: "Risk Mapping database tables are missing (e.g. after database restore). Please run 'npm run db:migrate' in your terminal.",
                is_schema_missing: true,
            },
            { status: 500 }
        );
    }

    if (lower.includes('econnrefused') && (lower.includes('9000') || process.env.STORAGE_BACKEND === 's3')) {
        const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
        return NextResponse.json(
            {
                success: false,
                error: `Could not connect to S3 storage at "${endpoint}". Please make sure the S3 service / Docker container is running.`,
            },
            { status: 500 }
        );
    }

    return NextResponse.json(
        {
            success: false,
            error: message,
        },
        { status: 500 }
    );
}
