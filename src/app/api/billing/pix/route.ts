import { mercadoPago, openPix } from '@/lib/access/billing';
import { devPaymentEnabled } from '@/lib/access/config';
import { currentAccess, sessionProblem } from '@/lib/access/guard';
import { purchaseFor } from '@/lib/access/purchase';
import { readSession } from '@/lib/access/session';
import { accessStore } from '@/lib/access/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Opens (or reuses) a Pix charge: access by default, or a sticker pack with `{ pack }`. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const access = await currentAccess(await readSession(), undefined, undefined, { fresh: true });
  const problem = sessionProblem(access);
  if (problem || !access) return problem!;
  const purchase = purchaseFor(access.user, access.status, body?.pack);
  if ('error' in purchase)
    return Response.json(
      { error: purchase.error, code: purchase.code },
      { status: purchase.status },
    );
  if (purchase.product.purpose === 'access' && access.status.state === 'paid')
    return Response.json({ access: access.status });
  const mp = mercadoPago();
  if (!mp && !devPaymentEnabled())
    return Response.json({ error: 'Pagamento indisponível no momento.' }, { status: 503 });
  try {
    const payment = await openPix(access.user, accessStore(), mp, Date.now(), purchase.product);
    return Response.json(
      {
        access: access.status,
        payment: {
          id: payment.id,
          amount: payment.amount,
          qrCode: payment.qrCode,
          qrCodeBase64: payment.qrCodeBase64,
          expiresAt: new Date(payment.expiresAt).toISOString(),
          simulated: !mp,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[billing] Pix charge failed', error);
    return Response.json(
      { error: 'Não foi possível gerar o Pix. Tente novamente.' },
      { status: 502 },
    );
  }
}
