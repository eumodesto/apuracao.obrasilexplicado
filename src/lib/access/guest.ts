import { randomInt, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { isGuest } from './access';
import { signIn } from './auth';
import { freeSeconds, sessionSecret } from './config';
import { bindContext } from './device';
import { cookieOptions } from './session';
import { sign, verify } from './signed';
import { accessStore } from './store';
import type { AccessStore } from './types';

/**
 * Remembers this browser's visitor account for a year, so signing out or closing the tab does not
 * give another free minute ("por navegador"). A private window starts over; that is accepted.
 * Switching browser profiles on the same network still shares the free-minute pool (IP + device).
 */
export const GUEST_COOKIE = 'rb_guest';
const GUEST_TTL_SECONDS = 365 * 24 * 60 * 60;

/** "Visitante 1234": four digits, more when the name is taken. */
export const guestName = (digits = 4) => `Visitante ${randomInt(10 ** (digits - 1), 10 ** digits)}`;

function guestIdFromToken(token: string | null | undefined) {
  const saved = verify<{ id: string }>(token ?? undefined, sessionSecret());
  return saved?.id && saved.id.startsWith('guest:') ? saved.id : null;
}

export type StartGuestOptions = {
  resume?: string | null;
  deviceId?: string | null;
  request?: Request;
};

/**
 * Signs this browser in as its visitor: the one it already had, or a new one. Free time already
 * spent on this IP / device is applied so a new profile cannot mint another free minute.
 */
export async function startGuest(
  store: AccessStore = accessStore(),
  options: StartGuestOptions | string | null = null,
) {
  const opts: StartGuestOptions =
    typeof options === 'string' || options === null
      ? { resume: options }
      : (options ?? {});
  const jar = await cookies();
  const bind = await bindContext(opts.request, opts.deviceId ?? null, { write: true });
  let id =
    guestIdFromToken(jar.get(GUEST_COOKIE)?.value) ?? guestIdFromToken(opts.resume ?? undefined);
  const existing = id ? await store.getUser(id) : null;
  if (!existing || existing.deletedAt || !isGuest(existing)) {
    id = `guest:${randomUUID()}`;
    let created = false;
    for (let attempt = 0; attempt < 8 && !created; attempt++)
      created = (await store.createGuest(id, guestName(attempt < 4 ? 4 : 6), Date.now())) === 'ok';
    if (!created) throw new Error('Could not create a visitor account.');
  }
  // IP / device pool: another browser profile on this apparatus may already have used the minute.
  const spent = await store.maxFreeQuota(bind.keys);
  if (spent > 0) await store.inheritFreeTime(id!, Math.min(spent, freeSeconds()));
  const token = sign({ id }, sessionSecret(), GUEST_TTL_SECONDS);
  jar.set(GUEST_COOKIE, token, cookieOptions(GUEST_TTL_SECONDS));
  await signIn({ sub: id!, email: '', name: 'Visitante' }, store);
  const user = await store.getUser(id!);
  if (user) await store.bumpFreeQuota(bind.keys, user.freeSecondsUsed);
  return { id: id!, resume: token, deviceId: bind.deviceId };
}
