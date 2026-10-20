import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from './types';

const API = 'https://api.mercadopago.com/v1/payments';

export type MercadoPagoPayment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  externalReference: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  expiresAt: number | null;
};

type Transport = typeof fetch;

/** Maps Mercado Pago's payment status to ours. Anything still in progress stays pending. */
export function paymentStatus(status: string): PaymentStatus {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled' || status === 'refunded' || status === 'charged_back')
    return 'cancelled';
  return 'pending';
}

export class MercadoPago {
  constructor(
    private accessToken: string,
    private transport: Transport = fetch,
  ) {}

  async createPix(input: {
    amount: number;
    email: string;
    userId: string;
    description: string;
    expiresAt: number;
    notificationUrl: string | null;
  }) {
    const response = await this.transport(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: input.amount,
        description: input.description,
        payment_method_id: 'pix',
        payer: { email: input.email },
        external_reference: input.userId,
        date_of_expiration: mercadoPagoDate(input.expiresAt),
        ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Mercado Pago recusou a cobrança (${response.status}).`);
    const payment = toPayment(await response.json());
    if (!payment.qrCode) throw new Error('Mercado Pago não retornou o código Pix.');
    return payment;
  }

  async getPayment(id: string) {
    const response = await this.transport(`${API}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`Mercado Pago não encontrou o pagamento (${response.status}).`);
    return toPayment(await response.json());
  }
}

type RawPayment = {
  id: number | string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
};

function toPayment(raw: RawPayment): MercadoPagoPayment {
  const data = raw.point_of_interaction?.transaction_data;
  return {
    id: String(raw.id),
    status: raw.status,
    amount: Number(raw.transaction_amount),
    currency: raw.currency_id,
    externalReference: raw.external_reference ?? null,
    qrCode: data?.qr_code ?? null,
    qrCodeBase64: data?.qr_code_base64 ?? null,
    expiresAt: raw.date_of_expiration ? Date.parse(raw.date_of_expiration) : null,
  };
}

/** Mercado Pago expects `yyyy-MM-ddTHH:mm:ss.SSS-03:00`; Brasília has no daylight saving time. */
export function mercadoPagoDate(at: number) {
  return new Date(at - 3 * 3600_000).toISOString().replace('Z', '-03:00');
}

/**
 * Checks the `x-signature` header of a webhook against the secret configured in Mercado Pago.
 * Manifest: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 */
export function validWebhookSignature(input: {
  secret: string;
  signature: string | null;
  requestId: string | null;
  dataId: string;
}) {
  if (!input.signature) return false;
  const parts = Object.fromEntries(
    input.signature.split(',').map((part) => part.trim().split('=') as [string, string]),
  );
  if (!parts.ts || !parts.v1) return false;
  let manifest = `id:${input.dataId.toLowerCase()};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = Buffer.from(createHmac('sha256', input.secret).update(manifest).digest('hex')),
    received = Buffer.from(parts.v1);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
