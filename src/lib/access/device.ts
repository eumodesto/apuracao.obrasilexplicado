import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { cookieOptions } from './session';
import { sessionSecret } from './config';
import { sign, verify } from './signed';
import { clientIp } from './rate-limit';

/** HttpOnly mirror of the browser device id (survives JS storage clears in the same profile). */
export const DEVICE_COOKIE = 'rb_device';
const DEVICE_TTL_SECONDS = 365 * 24 * 60 * 60;

/** localStorage key; must stay in sync with guest-start / password-form. */
export const DEVICE_STORAGE_KEY = 'rb_device';

const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;

export function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return DEVICE_ID_RE.test(id) ? id : null;
}

/**
 * Keys that share one free-minute pool. IP covers switching browser profiles on the same
 * network; device id covers clearing cookies in the same profile.
 */
export function freeQuotaKeys(ip: string, deviceId: string | null) {
  const keys = [`ip:${ip || 'local'}`];
  if (deviceId) keys.push(`dev:${deviceId}`);
  return keys;
}

export async function readDeviceId(resumeDevice: string | null = null) {
  const jar = await cookies();
  const fromCookie = verify<{ id: string }>(jar.get(DEVICE_COOKIE)?.value, sessionSecret())?.id;
  return normalizeDeviceId(fromCookie) ?? normalizeDeviceId(resumeDevice);
}

/** Only call from a Route Handler or Server Action — never from a Server Component. */
export async function rememberDeviceId(deviceId: string) {
  const id = normalizeDeviceId(deviceId) ?? randomUUID();
  (await cookies()).set(
    DEVICE_COOKIE,
    sign({ id }, sessionSecret(), DEVICE_TTL_SECONDS),
    cookieOptions(DEVICE_TTL_SECONDS),
  );
  return id;
}

export type BindOptions = {
  /** Persist `rb_device`. Must be true only in Route Handlers / Server Actions. */
  write?: boolean;
};

/**
 * IP + device keys for the free-minute pool.
 * Default is read-only (safe in Server Components). Pass `{ write: true }` from route handlers
 * so the device cookie can be set.
 */
export async function bindContext(
  request?: Request,
  resumeDevice: string | null = null,
  options: BindOptions = {},
) {
  const ip = request
    ? clientIp(request)
    : (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const existing = await readDeviceId(resumeDevice);
  const deviceId = options.write
    ? await rememberDeviceId(existing ?? randomUUID())
    : existing;
  return { ip, deviceId, keys: freeQuotaKeys(ip, deviceId) };
}
