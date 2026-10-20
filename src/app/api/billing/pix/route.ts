import { mercadoPago, openPix } from '@/lib/access/billing';
import { devPaymentEnabled } from '@/lib/access/config';
import { currentAccess } from '@/lib/access/guard';
import { readSession } from '@/lib/access/session';
import { accessStore } from '@/lib/access/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Opens (or reuses) the signed-in user's Pix charge. */
export async function POST() {
  const access = await currentAccess(await readSession(), undefined, undefined, { fresh: true });
  if (!access) return Response.json({ error: 'Faça login para continuar.' }, { status: 401 });
  if (access.status.state === 'paid') return Response.json({ access: access.status });
  const mp = mercadoPago();
  if (!mp && !devPaymentEnabled())
    return Response.json({ error: 'Pagamento indisponível no momento.' }, { status: 503 });
  try {
    const payment = await openPix(access.user, accessStore(), mp);
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
