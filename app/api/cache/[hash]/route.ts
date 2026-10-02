/**
 * GET  /api/cache/[hash]   — look up cache entry by SHA256 image hash
 * DELETE /api/cache/[hash] — manually invalidate cache entry
 *
 * Cache expires only on explicit invalidation (no TTL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { lookupCache, invalidateCache } from '@/lib/symbol-cache';

type RouteParams = { params: Promise<{ hash: string }> };

export async function GET(_: NextRequest, { params }: RouteParams) {
  const { hash } = await params;
  try {
    if (!hash || hash.length !== 64) {
      return NextResponse.json(
        { error: 'hash must be a 64-char SHA256 hex string' },
        { status: 400 }
      );
    }

    const entry = await lookupCache(hash);
    if (!entry) {
      return NextResponse.json({ found: false, entry: null }, { status: 200 });
    }

    return NextResponse.json({ found: true, entry });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[cache GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: RouteParams) {
  const { hash } = await params;
  try {
    if (!hash || hash.length !== 64) {
      return NextResponse.json(
        { error: 'hash must be a 64-char SHA256 hex string' },
        { status: 400 }
      );
    }

    await invalidateCache(hash);
    return NextResponse.json({ invalidated: true, hash });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[cache DELETE]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
