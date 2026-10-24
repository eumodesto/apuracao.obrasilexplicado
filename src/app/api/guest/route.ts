import { activeSession } from '@/lib/access/auth';
import { startGuest } from '@/lib/access/guest';
import { allow, clientIp } from '@/lib/access/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * First visit without an account: signs the browser in as a visitor ("Visitante 1234") with the
 * free minute. Called by the home page; a valid session is left as it is.
 * Body may include `{ resume, deviceId }` from localStorage when cookies were cleared.
 */
export async function POST(request: Request) {
  if (await activeSession())
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  // Generous: many people share one address on mobile networks.
  if (!(await allow(`guest:ip:${clientIp(request)}`, 60, 60_000)))
    return Response.json(
      { error: 'Muitas visitas deste endereço. Tente em instantes.' },
      { status: 429 },
    );
  try {
    const body = (await request.json().catch(() => null)) as {
      resume?: unknown;
      deviceId?: unknown;
    } | null;
    const resume = typeof body?.resume === 'string' ? body.resume : null;
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : null;
    const started = await startGuest(undefined, { resume, deviceId, request });
    return Response.json(
      { ok: true, resume: started.resume, deviceId: started.deviceId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[guest] could not start a visitor', error);
    return Response.json({ error: 'Não foi possível abrir o painel agora.' }, { status: 503 });
  }
}
