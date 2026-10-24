import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/access/session';

/**
 * The home page opens without an account (a visitor session starts there, with the free minute).
 * The sign-up page needs a session: without the cookie it goes to the login page.
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') return;
  if (!request.cookies.has(SESSION_COOKIE))
    return NextResponse.redirect(new URL('/login', request.url));
}

export const config = { matcher: ['/', '/cadastro'] };
