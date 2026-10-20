import { NextResponse, type NextRequest } from 'next/server';
import { countIsOpen } from '@/lib/access/config';
import { SESSION_COOKIE } from '@/lib/access/session';

/**
 * Sends visitors without a session cookie to the login page with a real HTTP redirect, before the
 * panel starts streaming. The page still validates the cookie's signature.
 */
export function proxy(request: NextRequest) {
  // Before the count starts, the home page is a public countdown.
  if (request.nextUrl.pathname === '/' && !countIsOpen()) return;
  if (!request.cookies.has(SESSION_COOKIE))
    return NextResponse.redirect(new URL('/login', request.url));
}

export const config = { matcher: ['/', '/cadastro'] };
