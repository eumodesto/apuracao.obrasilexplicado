import { randomInt, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { isGuest } from './access';
import { signIn } from './auth';
import { cookieOptions } from './session';
import { sign, verify } from './signed';
import { sessionSecret } from './config';
import { accessStore } from './store';
import type { AccessStore } from './types';

/**
 * Remembers this browser's visitor account for a year, so signing out or closing the tab does not
 * give another free minute ("por navegador"). A private window starts over; that is accepted.
 */
export const GUEST_COOKIE = 'rb_guest';
const GUEST_TTL_SECONDS = 365 * 24 * 60 * 60;

/** "Visitante 1234": four digits, more when the name is taken. */
export const guestName = (digits = 4) => `Visitante ${randomInt(10 ** (digits - 1), 10 ** digits)}`;

function guestIdFromToken(token: string | null | undefined) {
  const saved = verify<{ id: string }>(token ?? undefined, sessionSecret());
  return saved?.id && saved.id.startsWith('guest:') ? saved.id : null;
}

/**
 * Signs this browser in as its visitor: the one it already had, or a new one. Free time is counted
 * on that account like on any other.
 *
 * `resume` is an optional signed token from localStorage when the HttpOnly cookie was lost.
 */
export async function startGuest(
  store: AccessStore = accessStore(),
  resume: string | null = null,
) {
  const jar = await cookies();
  let id =
    guestIdFromToken(jar.get(GUEST_COOKIE)?.value) ?? guestIdFromToken(resume ?? undefined);
  const existing = id ? await store.getUser(id) : null;
  if (!existing || existing.deletedAt || !isGuest(existing)) {
    id = `guest:${randomUUID()}`;
    let created = false;
    for (let attempt = 0; attempt < 8 && !created; attempt++)
      created = (await store.createGuest(id, guestName(attempt < 4 ? 4 : 6), Date.now())) === 'ok';
    if (!created) throw new Error('Could not create a visitor account.');
  }
  const token = sign({ id }, sessionSecret(), GUEST_TTL_SECONDS);
  jar.set(GUEST_COOKIE, token, cookieOptions(GUEST_TTL_SECONDS));
  await signIn({ sub: id!, email: '', name: 'Visitante' }, store);
  return { id: id!, resume: token };
}
