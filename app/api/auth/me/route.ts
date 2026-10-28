import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    return NextResponse.json({ user });
  } catch (err: any) {
    console.error('[auth/me] error:', err);
    return NextResponse.json({ user: null, error: err.message }, { status: 500 });
  }
}
