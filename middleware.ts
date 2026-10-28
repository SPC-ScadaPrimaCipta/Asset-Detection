import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Static resources and files to always allow
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.includes('.') // static files like .png, .mjs, .svg, etc.
  ) {
    return NextResponse.next();
  }

  // 2. Public API routes (auth endpoints, health check)
  if (pathname.startsWith('/api/auth') || pathname === '/api/health') {
    return NextResponse.next();
  }

  // 3. Verify session token from cookie
  const token = request.cookies.get('asset_session')?.value;
  let hasValidSession = false;

  if (token) {
    try {
      const parts = token.split('.');
      if (parts.length === 2) {
        const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
        const jsonStr = Buffer.from(base64, 'base64').toString('utf-8');
        const data = JSON.parse(jsonStr);
        if (data.userId && data.exp && data.exp > Math.floor(Date.now() / 1000)) {
          hasValidSession = true;
        }
      }
    } catch {}
  }

  // If someone attempts to access /register directly, redirect to login
  if (pathname === '/register') {
    return NextResponse.redirect(new URL('/login?notice=registration_disabled', request.url));
  }

  const isAuthPage = pathname === '/login';

  // 4. If logged-in user visits /login, redirect to dashboard /
  if (hasValidSession && isAuthPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // 5. If unauthenticated user tries to access any page, redirect to /login
  if (!hasValidSession && !isAuthPage) {
    // For protected API endpoints, return 401 Unauthorized
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized. Please login.' }, { status: 401 });
    }
    // For web pages, redirect to login page
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
