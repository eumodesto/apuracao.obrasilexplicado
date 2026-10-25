import { mercadoPago, refreshPayment } from '@/lib/access/billing';
import { currentAccess, sessionProblem } from '@/lib/access/guard';
import { readSession } from '@/lib/access/session';
import { accessStore } from '@/lib/access/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Polled while the Pix screen is open; confirms the payment even if the webhook never arrives. */
export async function GET(request: Request) {
  // The charge the Pix screen is watching; without it, the user's latest.
  const id = new URL(request.url).searchParams.get('id');
  const paymentId = id && id.length <= 100 ? id : null;
  const session = await readSession();
  const before = await currentAccess(session, undefined, undefined, { fresh: true });
  const problem = sessionProblem(before);
  if (problem || !before) return problem!;
  let payment = null;
  try {
    payment = await refreshPayment(
      before.user,
      accessStore(),
      mercadoPago(),
      Date.now(),
      paymentId,
    );
  } catch (error) {
    console.error('[billing] payment refresh failed', error);
  }
  const after = await currentAccess(session, undefined, undefined, { fresh: true });
  return Response.json(
    { access: after!.status, paymentStatus: payment?.status ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
