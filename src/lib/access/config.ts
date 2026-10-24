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

/** Public key for Mercado Pago's card form in the browser (not a secret). */
export const mercadoPagoPublicKey = () => process.env.MP_PUBLIC_KEY || null;

export function mercadoPagoConfig() {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  return accessToken ? { accessToken, webhookSecret: process.env.MP_WEBHOOK_SECRET || null } : null;
}

/** Local shortcuts (test login, simulated Pix) exist only in `next dev` without real credentials. */
export const devLoginEnabled = () => isDevelopment();
export const devPaymentEnabled = () => isDevelopment() && !mercadoPagoConfig();

/**
 * Team members who always have full access, without free time or payment.
 * Safe because these e-mails cannot sign up on the site: their password is set only on the server.
 */
const emailList = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export function staffEmails() {
  // Administrators are part of the team too.
  return new Set([...emailList(process.env.STAFF_EMAILS), ...emailList(process.env.ADMIN_EMAILS)]);
}

/** Who may open /admin (reserved e-mails, with the password set on the server). */
export function adminEmails() {
  return new Set(emailList(process.env.ADMIN_EMAILS));
}

export function freeSeconds() {
  // An empty variable means "not set", not zero seconds.
  const value = Number(process.env.FREE_SECONDS || NaN);
  return Number.isFinite(value) && value >= 0 ? value : 60;
}

export function priceBrl() {
  const value = Number(process.env.ACCESS_PRICE_BRL);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 5;
}

/**
 * When the 2nd-round count opens (polls close at 17h in Brasília). Before it, the panel still
 * opens on `/`, but the left column and "Por região" keep showing the official 1st round.
 */
export function countStartsAt() {
  const value = Date.parse(process.env.COUNT_STARTS_AT || '2026-10-25T17:00:00-03:00');
  if (Number.isNaN(value)) throw new Error('COUNT_STARTS_AT must be an ISO date.');
  return value;
}

/** Whether the 2nd-round count window has started (swap 1st-round boards for live ones). */
export const countIsOpen = (now = Date.now()) => now >= countStartsAt();

/**
 * Testing switch (OPEN_ACCESS=true): every signed-in account gets full access, as if paid, and can
 * write in the chat. No free time, no payment. Turn it off before the count.
 */
export const openAccess = () => process.env.OPEN_ACCESS === 'true';

/**
 * Legacy end date for paid access. Unused: one payment now unlocks the panel for life.
 * Kept so old env files and docs that still set PAID_ACCESS_ENDS_AT do not break.
 */
export function paidAccessEndsAt() {
  const value = Date.parse(process.env.PAID_ACCESS_ENDS_AT || '2099-12-31T23:59:59-03:00');
  if (Number.isNaN(value)) throw new Error('PAID_ACCESS_ENDS_AT must be an ISO date.');
  return value;
}

/** Longest gap between two requests that still counts as watching. */
export const MAX_ACTIVITY_GAP_SECONDS = 30;
export const PIX_EXPIRATION_MINUTES = 30;
