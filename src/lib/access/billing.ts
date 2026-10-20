import { randomUUID } from 'node:crypto';
import { mercadoPagoConfig, PIX_EXPIRATION_MINUTES, priceBrl, siteUrl } from './config';
import { MercadoPago, paymentStatus, type MercadoPagoPayment } from './mercadopago';
import type { AccessStore, AccessUser, PixPayment } from './types';

export const mercadoPago = () => {
  const config = mercadoPagoConfig();
  return config ? new MercadoPago(config.accessToken) : null;
};

/** Mercado Pago only calls public HTTPS addresses, so localhost relies on status polling. */
export function webhookUrl(base = siteUrl()) {
  return base.startsWith('https://') ? `${base}/api/billing/webhook` : null;
}

/**
 * Returns the user's open Pix charge or creates a new one.
 * Without Mercado Pago (`mp` null) it creates a simulated charge; callers allow that only in dev.
 */
export async function openPix(
  user: AccessUser,
  store: AccessStore,
  mp: MercadoPago | null,
  now = Date.now(),
  amount = priceBrl(),
): Promise<PixPayment> {
  const latest = await store.latestPayment(user.id);
  // Keep at least two minutes to pay before reusing an existing code.
  if (latest?.status === 'pending' && latest.expiresAt - now > 2 * 60_000) return latest;
  const expiresAt = now + PIX_EXPIRATION_MINUTES * 60_000;
  const payment: PixPayment = mp
    ? fromMercadoPago(
        await mp.createPix({
          amount,
          email: user.email,
          userId: user.id,
          description: 'Resultados Brasil — acesso à apuração até o resultado final',
          expiresAt,
          notificationUrl: webhookUrl(),
        }),
        user.id,
        expiresAt,
        now,
      )
    : {
        id: `dev-${randomUUID()}`,
        userId: user.id,
        status: 'pending',
        amount,
        qrCode:
          '00020126580014br.gov.bcb.pix0136PIX-SIMULADO-APENAS-DESENVOLVIMENTO5204000053039865405' +
          amount.toFixed(2),
        qrCodeBase64: null,
        expiresAt,
        createdAt: now,
      };
  await store.savePayment(payment);
  return payment;
}

const fromMercadoPago = (
  payment: MercadoPagoPayment,
  userId: string,
  expiresAt: number,
  now: number,
): PixPayment => ({
  id: payment.id,
  userId,
  status: paymentStatus(payment.status),
  amount: payment.amount,
  qrCode: payment.qrCode!,
  qrCodeBase64: payment.qrCodeBase64,
  expiresAt: payment.expiresAt ?? expiresAt,
  createdAt: now,
});

/**
 * Applies Mercado Pago's current view of a payment. Access is granted only when the payment is
 * approved, in BRL, for at least the price, and belongs to the user who opened the charge.
 */
export async function applyPayment(
  remote: MercadoPagoPayment,
  store: AccessStore,
  now = Date.now(),
  price = priceBrl(),
) {
  const local = await store.getPayment(remote.id);
  if (!local) return false;
  const status = paymentStatus(remote.status);
  if (status !== local.status) await store.setPaymentStatus(local.id, status);
  const valid =
    status === 'approved' &&
    remote.currency === 'BRL' &&
    remote.amount >= price &&
    remote.externalReference === local.userId;
  if (valid) await store.markPaid(local.userId, local.id, now);
  return valid;
}

/** Checks the user's latest pending charge with Mercado Pago (covers missed or local webhooks). */
export async function refreshPayment(
  user: AccessUser,
  store: AccessStore,
  mp: MercadoPago | null,
  now = Date.now(),
) {
  const latest = await store.latestPayment(user.id);
  if (!latest || latest.status !== 'pending' || !mp) return latest;
  await applyPayment(await mp.getPayment(latest.id), store, now);
  return store.getPayment(latest.id);
}
