import { createHmac, timingSafeEqual } from 'node:crypto';

/** Compact `payload.signature` token: base64url JSON signed with HMAC-SHA256, with expiry. */
export function sign(value: object, secret: string, ttlSeconds: number, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ ...value, exp: Math.floor(now / 1000) + ttlSeconds }),
  ).toString('base64url');
  return `${payload}.${digest(payload, secret)}`;
}

export function verify<T>(token: string | undefined, secret: string, now = Date.now()): T | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(digest(payload, secret)),
    received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof value?.exp !== 'number' || value.exp * 1000 <= now) return null;
    return value as T;
  } catch {
    return null;
  }
}

const digest = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');
