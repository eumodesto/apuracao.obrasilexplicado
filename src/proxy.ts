import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/access/session';

/**
 * Sends visitors without a session cookie to the login page with a real HTTP redirect, before the
 * panel starts streaming. The page still validates the cookie's signature.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE))
    return NextResponse.redirect(new URL('/login', request.url));
}

export const config = { matcher: ['/'] };
