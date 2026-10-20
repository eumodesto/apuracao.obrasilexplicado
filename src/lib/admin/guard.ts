import { isAdmin } from '@/lib/access/access';
import { activeSession } from '@/lib/access/auth';

/** The signed-in administrator, or null (also for suspended accounts). */
export async function adminSession() {
  const active = await activeSession();
  return active && isAdmin(active.user) ? active : null;
}

/**
 * Changes must come from this site's own pages: a cross-site form cannot act on behalf of a
 * signed-in administrator (the session cookie is SameSite=Lax, which still allows top-level POSTs).
 */
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Admin = NonNullable<Awaited<ReturnType<typeof adminSession>>>;
type Handler<C> = (request: Request, context: C, admin: Admin) => Promise<Response>;

/** Admin API: 404 for everyone else (the area does not reveal itself), 403 for foreign origins. */
export function withAdmin<C>(handler: Handler<C>) {
  return async (request: Request, context: C) => {
    const admin = await adminSession();
    if (!admin) return new Response(null, { status: 404 });
    if (request.method !== 'GET' && !sameOrigin(request))
      return Response.json({ error: 'Origem não permitida.' }, { status: 403 });
    return handler(request, context, admin);
  };
}
