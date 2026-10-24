import { mercadoPago, payWithCard } from '@/lib/access/billing';
import { devPaymentEnabled } from '@/lib/access/config';
import { currentAccess, sessionProblem } from '@/lib/access/guard';
import { cardMessage, purchaseFor } from '@/lib/access/purchase';
import { allow } from '@/lib/access/rate-limit';
import { readSession } from '@/lib/access/session';
import { accessStore } from '@/lib/access/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (value: unknown, max = 100) =>
  typeof value === 'string' && value.length <= max ? value : null;

/**
 * Card payment with the token from Mercado Pago's form in the browser (the card number never
 * reaches this server): access by default, or a sticker pack with `pack`. The amount is the
 * product price, whatever the browser sends.
 */
export async function POST(request: Request) {
  const session = await readSession();
  const access = await currentAccess(session, undefined, undefined, { fresh: true });
  const problem = sessionProblem(access);
  if (problem || !access) return problem!;
  const body = await request.json().catch(() => null);
  const purchase = purchaseFor(access.user, access.status, body?.pack);
  if ('error' in purchase)
    return Response.json(
      { error: purchase.error, code: purchase.code },
      { status: purchase.status },
    );
  if (purchase.product.purpose === 'access' && access.status.state === 'paid')
    return Response.json({ status: 'approved', access: access.status });
  const mp = mercadoPago();
  if (!mp && !devPaymentEnabled())
    return Response.json({ error: 'Pagamento indisponível no momento.' }, { status: 503 });
  // Testing stolen cards is the usual abuse of payment forms.
  if (!(await allow(`card:${access.user.id}`, 5, 10 * 60_000)))
    return Response.json(
      { error: 'Muitas tentativas com cartão. Espere alguns minutos ou use o Pix.' },
      { status: 429 },
    );
  const token = text(body?.token, 200),
    methodId = text(body?.payment_method_id, 40),
    installments = Number(body?.installments ?? 1);
  if (mp && (!token || !methodId || !Number.isInteger(installments) || installments < 1))
    return Response.json({ error: 'Confira os dados do cartão.' }, { status: 400 });
  const idType = text(body?.payer?.identification?.type, 10),
    idNumber = text(body?.payer?.identification?.number, 20);
  try {
    const result = await payWithCard(
      access.user,
      accessStore(),
      mp,
      {
        token: token ?? 'dev',
        installments: mp ? Math.min(installments, 12) : 1,
        paymentMethodId: methodId ?? 'dev',
        issuerId: text(body?.issuer_id, 20),
        identification: idType && idNumber ? { type: idType, number: idNumber } : null,
        email: text(body?.payer?.email, 254) ?? undefined,
      },
      purchase.product,
    );
    const after = await currentAccess(session, undefined, undefined, { fresh: true });
    return Response.json(
      {
        status: result.status,
        message: result.status === 'approved' ? null : cardMessage(result.detail),
        access: after?.status,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[billing] card payment failed', error);
    return Response.json(
      { error: 'Não foi possível processar o cartão. Tente de novo ou pague com Pix.' },
      { status: 502 },
    );
  }
}
