import { applyPayment, mercadoPago } from '@/lib/access/billing';
import { mercadoPagoConfig } from '@/lib/access/config';
import { validWebhookSignature } from '@/lib/access/mercadopago';
import { accessStore } from '@/lib/access/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Mercado Pago payment notifications. The body is never trusted: the payment is read back from
 * Mercado Pago before granting access.
 */
export async function POST(request: Request) {
  const config = mercadoPagoConfig(),
    mp = mercadoPago();
  if (!config || !mp) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const type = body?.type ?? url.searchParams.get('type'),
    dataId = String(body?.data?.id ?? url.searchParams.get('data.id') ?? '');
  if (type !== 'payment' || !/^\w+$/.test(dataId)) return new Response(null, { status: 200 });
  if (
    config.webhookSecret &&
    !validWebhookSignature({
      secret: config.webhookSecret,
      signature: request.headers.get('x-signature'),
      requestId: request.headers.get('x-request-id'),
      dataId: url.searchParams.get('data.id') ?? dataId,
    })
  )
    return new Response(null, { status: 401 });
  try {
    await applyPayment(await mp.getPayment(dataId), accessStore());
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error('[billing] webhook failed', error);
    // A non-2xx answer makes Mercado Pago retry later.
    return new Response(null, { status: 500 });
  }
}
