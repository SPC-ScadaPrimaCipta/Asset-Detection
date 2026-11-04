import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isPrivileged } from '@/lib/auth';
import * as fs from 'fs';
import * as path from 'path';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!isPrivileged(user)) {
      return NextResponse.json({ error: 'Akses ditolak: Hanya Admin dan Superadmin yang diizinkan mengunduh panduan teknis ini.' }, { status: 403 });
    }

    const filePath = path.resolve(process.cwd(), 'scripts/train_yolo_pid_colab.ipynb');
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Notebook file not found' }, { status: 404 });
    }
    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/x-ipynb+json',
        'Content-Disposition': 'attachment; filename="train_yolo_pid_colab.ipynb"',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
