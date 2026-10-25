import { randomUUID } from 'node:crypto';
import { mercadoPagoConfig, PIX_EXPIRATION_MINUTES, siteUrl } from './config';
import { forgetAccess } from './guard';
import { MercadoPago, paymentStatus, type CardInput, type MercadoPagoPayment } from './mercadopago';
import { accessProduct, type Product } from './products';
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
 * Returns the user's open Pix charge for this product or creates a new one.
 * Without Mercado Pago (`mp` null) it creates a simulated charge; callers allow that only in dev.
 */
export async function openPix(
  user: AccessUser,
  store: AccessStore,
  mp: MercadoPago | null,
  now = Date.now(),
  product: Product = accessProduct(),
): Promise<PixPayment> {
  const latest = await store.latestPayment(user.id);
  // Keep at least two minutes to pay before reusing an existing code for the same purchase.
  if (
    latest?.status === 'pending' &&
    latest.method === 'pix' &&
    latest.purpose === product.purpose &&
    latest.amount === product.amount &&
    latest.expiresAt - now > 2 * 60_000
  )
    return latest;
  const expiresAt = now + PIX_EXPIRATION_MINUTES * 60_000;
  const base = { purpose: product.purpose, method: 'pix' as const, credits: product.credits };
  const payment: PixPayment = mp
    ? {
        ...fromMercadoPago(
          await mp.createPix({
            amount: product.amount,
            email: user.email,
            userId: user.id,
            description: product.description,
            expiresAt,
            notificationUrl: webhookUrl(),
          }),
          user.id,
          expiresAt,
          now,
        ),
        ...base,
      }
    : {
        id: `dev-${randomUUID()}`,
        userId: user.id,
        status: 'pending',
        amount: product.amount,
        qrCode:
          '00020126580014br.gov.bcb.pix0136PIX-SIMULADO-APENAS-DESENVOLVIMENTO5204000053039865405' +
          product.amount.toFixed(2),
        qrCodeBase64: null,
        expiresAt,
        createdAt: now,
        ...base,
      };
  await store.savePayment(payment);
  return payment;
}

/**
 * Charges a card tokenized in the browser by Mercado Pago's form (the card number never reaches
 * this server). The amount comes from the product, never from the browser. Without Mercado Pago
 * (dev only) the charge is simulated and approved.
 */
export async function payWithCard(
  user: AccessUser,
  store: AccessStore,
  mp: MercadoPago | null,
  card: Omit<CardInput, 'amount' | 'userId' | 'description' | 'notificationUrl' | 'email'> & {
    email?: string;
  },
  product: Product = accessProduct(),
  now = Date.now(),
) {
  const remote: MercadoPagoPayment = mp
    ? await mp.createCard({
        ...card,
        amount: product.amount,
        email: user.email || card.email || '',
        userId: user.id,
        description: product.description,
        notificationUrl: webhookUrl(),
      })
    : {
        id: `dev-card-${randomUUID()}`,
        status: 'approved',
        statusDetail: 'accredited',
        amount: product.amount,
        currency: 'BRL',
        externalReference: user.id,
        qrCode: null,
        qrCodeBase64: null,
        expiresAt: null,
      };
  await store.savePayment({
    id: remote.id,
    userId: user.id,
    status: 'pending',
    amount: product.amount,
    qrCode: '',
    qrCodeBase64: null,
    expiresAt: now,
    createdAt: now,
    purpose: product.purpose,
    method: 'card',
    credits: product.credits,
  });
  await applyPayment(remote, store, now);
  return { status: paymentStatus(remote.status), detail: remote.statusDetail };
}

const fromMercadoPago = (
  payment: MercadoPagoPayment,
  userId: string,
  expiresAt: number,
  now: number,
) => ({
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
 * Applies Mercado Pago's current view of a payment. Its effect (access, or a sticker pack) is
 * granted only when the payment is approved, in BRL, for at least the amount charged, belongs to
 * the user who opened it, and only once even if the webhook and the polling both see it.
 */
export async function applyPayment(
  remote: MercadoPagoPayment,
  store: AccessStore,
  now = Date.now(),
) {
  const local = await store.getPayment(remote.id);
  if (!local) return false;
  const status = paymentStatus(remote.status);
  const valid =
    status === 'approved' &&
    remote.currency === 'BRL' &&
    remote.amount >= local.amount &&
    remote.externalReference === local.userId;
  if (!valid) {
    if (status !== local.status) await store.setPaymentStatus(local.id, status);
    return false;
  }
  if (await store.approvePayment(local.id)) {
    if (local.purpose === 'stickers')
      await store.addStickerCredits(local.userId, local.credits ?? 0);
    else await store.markPaid(local.userId, local.id, now);
    forgetAccess(local.userId);
  }
  return true;
}

/**
 * Checks a pending charge with Mercado Pago (covers missed or local webhooks): the one the screen
 * is watching when `paymentId` is given, otherwise the user's latest. Watching by id matters: a
 * card attempt made after the Pix opened becomes the latest, and the paid Pix must still count.
 */
export async function refreshPayment(
  user: AccessUser,
  store: AccessStore,
  mp: MercadoPago | null,
  now = Date.now(),
  paymentId?: string | null,
) {
  const payment = paymentId
    ? await store.getPayment(paymentId)
    : await store.latestPayment(user.id);
  if (!payment || payment.userId !== user.id) return null;
  if (payment.status !== 'pending' || !mp) return payment;
  await applyPayment(await mp.getPayment(payment.id), store, now);
  return store.getPayment(payment.id);
}
