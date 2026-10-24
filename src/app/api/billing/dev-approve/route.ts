import { devPaymentEnabled } from '@/lib/access/config';
import { activeSession } from '@/lib/access/auth';
import { forgetAccess } from '@/lib/access/guard';
import { accessStore } from '@/lib/access/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Approves the simulated Pix in `next dev` without Mercado Pago credentials. Absent in production. */
export async function POST() {
  const session = devPaymentEnabled() ? (await activeSession())?.session : null;
  if (!session) return new Response(null, { status: 404 });
  const store = accessStore(),
    payment = await store.latestPayment(session.sub);
  if (!payment?.id.startsWith('dev-') || payment.status !== 'pending')
    return Response.json({ error: 'Nenhum Pix simulado pendente.' }, { status: 409 });
  if (await store.approvePayment(payment.id)) {
    if (payment.purpose === 'stickers')
      await store.addStickerCredits(session.sub, payment.credits ?? 0);
    else await store.markPaid(session.sub, payment.id, Date.now());
    forgetAccess(session.sub);
  }
  return Response.json({ ok: true });
}
