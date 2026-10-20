import { devPaymentEnabled } from '@/lib/access/config';
import { readSession } from '@/lib/access/session';
import { accessStore } from '@/lib/access/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Approves the simulated Pix in `next dev` without Mercado Pago credentials. Absent in production. */
export async function POST() {
  const session = await readSession();
  if (!devPaymentEnabled() || !session) return new Response(null, { status: 404 });
  const store = accessStore(),
    payment = await store.latestPayment(session.sub);
  if (!payment?.id.startsWith('dev-') || payment.status !== 'pending')
    return Response.json({ error: 'Nenhum Pix simulado pendente.' }, { status: 409 });
  await store.setPaymentStatus(payment.id, 'approved');
  await store.markPaid(session.sub, payment.id, Date.now());
  return Response.json({ ok: true });
}
