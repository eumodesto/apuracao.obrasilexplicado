import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from './types';

const API = 'https://api.mercadopago.com/v1/payments';

export type MercadoPagoPayment = {
  id: string;
  status: string;
  /** Why a card was declined (e.g. cc_rejected_insufficient_amount); null for Pix. */
  statusDetail?: string | null;
  amount: number;
  currency: string;
  externalReference: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  expiresAt: number | null;
};

type Transport = typeof fetch;

/** What Mercado Pago's card form returns in the browser, plus what the server decides. */
export type CardInput = {
  token: string;
  installments: number;
  paymentMethodId: string;
  issuerId: string | null;
  identification: { type: string; number: string } | null;
  email: string;
  amount: number;
  userId: string;
  description: string;
  notificationUrl: string | null;
};

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

  /** Card payment with a token created in the browser; the answer says approved or why not. */
  async createCard(input: CardInput) {
    const response = await this.transport(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: input.amount,
        token: input.token,
        description: input.description,
        installments: input.installments,
        payment_method_id: input.paymentMethodId,
        ...(input.issuerId ? { issuer_id: input.issuerId } : {}),
        payer: {
          email: input.email,
          ...(input.identification ? { identification: input.identification } : {}),
        },
        external_reference: input.userId,
        statement_descriptor: 'RESULTADOS BR',
        ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.id)
      throw new Error(`Mercado Pago recusou o cartão (${response.status}).`);
    return toPayment(body);
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
  status_detail?: string | null;
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
    statusDetail: raw.status_detail ?? null,
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
