import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { googleConfig, sessionSecret, siteUrl } from '@/lib/access/config';
import { googleProfile, OAUTH_COOKIE, type OAuthState } from '@/lib/access/google';
import { signIn } from '@/lib/access/auth';
import { verify } from '@/lib/access/signed';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams,
    base = siteUrl(),
    jar = await cookies();
  const oauth = verify<OAuthState>(jar.get(OAUTH_COOKIE)?.value, sessionSecret());
  jar.delete(OAUTH_COOKIE);
  const google = googleConfig(),
    code = params.get('code');
  if (!google || !oauth || !code || params.get('state') !== oauth.state)
    return NextResponse.redirect(new URL('/login?erro=login', base), 303);
  try {
    const profile = await googleProfile({ code, verifier: oauth.verifier, ...google, base });
    await signIn(profile);
    return NextResponse.redirect(new URL(oauth.next, base), 303);
  } catch (error) {
    console.error('[auth] Google login failed', error);
    return NextResponse.redirect(new URL('/login?erro=login', base), 303);
  }
}
