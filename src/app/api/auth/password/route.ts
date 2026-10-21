import { signIn } from '@/lib/access/auth';
import { logIn, signUp } from '@/lib/access/credentials';
import { safeNext } from '@/lib/access/next';
import { allow, clientIp } from '@/lib/access/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE = 60_000;

/**
 * E-mail and password: `{ mode: 'entrar', login, password }` or
 * `{ mode: 'criar', email, password }`. Answers `{ next }` with the session cookie, or `{ error }`.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const mode = body?.mode === 'criar' ? 'criar' : 'entrar';
  const ip = clientIp(request);
  // Generous per address (mobile carriers put many people behind one IP); strict per account.
  const login = String((mode === 'criar' ? body?.email : body?.login) ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 254);
  if (
    !(await allow(`auth:ip:${ip}`, 60, MINUTE)) ||
    (login && !(await allow(`auth:login:${login}`, 8, 5 * MINUTE)))
  )
    return Response.json(
      { error: 'Muitas tentativas. Espere alguns minutos e tente de novo.' },
      { status: 429 },
    );
  const result =
    mode === 'criar'
      ? await signUp({ email: body?.email, password: body?.password })
      : await logIn({ login: body?.login, password: body?.password });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  await signIn(result.profile);
  return Response.json(
    { next: safeNext(typeof body?.next === 'string' ? body.next : null) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
