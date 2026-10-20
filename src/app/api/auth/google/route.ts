import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { googleConfig, sessionSecret, siteUrl } from '@/lib/access/config';
import { authorizeUrl, newOAuthState, OAUTH_COOKIE } from '@/lib/access/google';
import { cookieOptions } from '@/lib/access/session';
import { sign } from '@/lib/access/signed';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const url = new URL(request.url),
    base = siteUrl();
  const google = googleConfig();
  if (!google) return NextResponse.redirect(new URL('/login?erro=config', base), 303);
  // The state cookie must be set on the same origin Google redirects back to.
  if (url.origin !== new URL(base).origin)
    return NextResponse.redirect(new URL(url.pathname + url.search, base), 307);
  const oauth = newOAuthState(url.searchParams.get('next') ?? '/');
  (await cookies()).set(OAUTH_COOKIE, sign(oauth, sessionSecret(), 600), cookieOptions(600));
  return NextResponse.redirect(authorizeUrl(google.clientId, base, oauth), 303);
}
