import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/access/session';

/**
 * The home page opens without an account (a visitor session starts there, with the free minute).
 * /login without a reason (admin next, or an error) goes back to the panel — no login modal first.
 * The sign-up page needs a session: without the cookie it goes home to open as a visitor.
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === '/') return;

  if (pathname === '/login') {
    const next = searchParams.get('next');
    const erro = searchParams.get('erro');
    const forAdminOrReturn = !!next && next.startsWith('/') && next !== '/';
    if (erro || forAdminOrReturn) return;
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (pathname === '/cadastro' && !request.cookies.has(SESSION_COOKIE))
    return NextResponse.redirect(new URL('/', request.url));
}

export const config = { matcher: ['/', '/cadastro', '/login'] };
