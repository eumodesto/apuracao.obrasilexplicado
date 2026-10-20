import { createHash, randomBytes } from 'node:crypto';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

export const OAUTH_COOKIE = 'rb_oauth';

export type OAuthState = { state: string; verifier: string; next: string };

export const redirectUri = (base: string) => `${base}/api/auth/google/callback`;

/** Only same-site paths are accepted as the post-login destination. */
export function safeNext(value: string | null | undefined) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/';
}

export function newOAuthState(next: string): OAuthState {
  return {
    state: randomBytes(24).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
    next: safeNext(next),
  };
}

/** Authorization Code flow with PKCE (S256). */
export function authorizeUrl(clientId: string, base: string, oauth: OAuthState) {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(base),
    response_type: 'code',
    scope: 'openid email profile',
    state: oauth.state,
    code_challenge: createHash('sha256').update(oauth.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export type GoogleProfile = { sub: string; email: string; name: string };

/** Exchanges the code and reads the profile straight from Google over TLS. */
export async function googleProfile(
  input: { code: string; verifier: string; clientId: string; clientSecret: string; base: string },
  transport: typeof fetch = fetch,
): Promise<GoogleProfile> {
  const token = await transport(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: redirectUri(input.base),
      grant_type: 'authorization_code',
      code_verifier: input.verifier,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!token.ok) throw new Error(`Google recusou o código de login (${token.status}).`);
  const { access_token: accessToken } = await token.json();
  const info = await transport(USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!info.ok) throw new Error(`Google não retornou o perfil (${info.status}).`);
  const profile = await info.json();
  if (!profile.sub || !profile.email || profile.email_verified !== true)
    throw new Error('A conta Google não tem um e-mail verificado.');
  return {
    sub: `google:${profile.sub}`,
    email: String(profile.email),
    name: String(profile.name || profile.email),
  };
}
