import { currentAccess, sessionProblem } from '@/lib/access/guard';
import { readSession } from '@/lib/access/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Heartbeat: counts watched time, checks the session is still active and returns the access. */
export async function POST() {
  const access = await currentAccess(await readSession(), undefined, undefined, {
    fresh: true,
    persistDevice: true,
  });
  const problem = sessionProblem(access);
  if (problem || !access) return problem!;
  return Response.json(access.status, { headers: { 'Cache-Control': 'no-store' } });
}
