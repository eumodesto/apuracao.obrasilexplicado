import { currentAccess } from '@/lib/access/guard';
import { readSession } from '@/lib/access/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Heartbeat: counts watched time and returns the current access state. */
export async function POST() {
  const access = await currentAccess(await readSession(), undefined, undefined, { fresh: true });
  if (!access) return Response.json({ error: 'Faça login para continuar.' }, { status: 401 });
  return Response.json(access.status, { headers: { 'Cache-Control': 'no-store' } });
}
