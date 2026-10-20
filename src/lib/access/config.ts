/** Access, login and payment settings. Every value comes from the environment. */
const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me-0123456789';

export const isDevelopment = () => process.env.NODE_ENV === 'development';

export function siteUrl() {
  return (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (isDevelopment()) return DEV_SESSION_SECRET;
  throw new Error('SESSION_SECRET must be set with at least 32 characters.');
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function mercadoPagoConfig() {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  return accessToken ? { accessToken, webhookSecret: process.env.MP_WEBHOOK_SECRET || null } : null;
}

/** Local shortcuts (test login, simulated Pix) exist only in `next dev` without real credentials. */
export const devLoginEnabled = () => isDevelopment() && !googleConfig();
export const devPaymentEnabled = () => isDevelopment() && !mercadoPagoConfig();

export function freeSeconds() {
  const value = Number(process.env.FREE_SECONDS);
  return Number.isFinite(value) && value >= 0 ? value : 300;
}

export function priceBrl() {
  const value = Number(process.env.ACCESS_PRICE_BRL);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 5;
}

/** Paid access lasts until the end of the count, not for a fixed duration. */
export function paidAccessEndsAt() {
  const value = Date.parse(process.env.PAID_ACCESS_ENDS_AT || '2026-10-31T23:59:59-03:00');
  if (Number.isNaN(value)) throw new Error('PAID_ACCESS_ENDS_AT must be an ISO date.');
  return value;
}

/** Longest gap between two requests that still counts as watching. */
export const MAX_ACTIVITY_GAP_SECONDS = 20;
export const PIX_EXPIRATION_MINUTES = 30;
