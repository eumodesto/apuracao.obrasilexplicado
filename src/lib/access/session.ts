import { cookies } from 'next/headers';
import { isDevelopment, sessionSecret } from './config';
import { sign, verify } from './signed';

export const SESSION_COOKIE = 'rb_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type Session = { sub: string; email: string; name: string };

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: !isDevelopment(),
  sameSite: 'lax' as const,
  path: '/',
  maxAge,
});

export async function readSession(): Promise<Session | null> {
  const value = verify<Session>((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
  return value?.sub ? { sub: value.sub, email: value.email, name: value.name } : null;
}

export async function startSession(session: Session) {
  (await cookies()).set(
    SESSION_COOKIE,
    sign(session, sessionSecret(), SESSION_TTL_SECONDS),
    cookieOptions(SESSION_TTL_SECONDS),
  );
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
