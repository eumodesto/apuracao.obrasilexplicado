import { randomBytes } from 'node:crypto';
import { forgetAccess } from './guard';
import { readSession, startSession, type Session } from './session';
import { accessStore } from './store';
import type { AccessStore } from './types';

/**
 * Signs the account in on this device. The new session becomes the only valid one, so any other
 * device using the account is signed out on its next request.
 */
export async function signIn(profile: Omit<Session, 'sid'>, store: AccessStore = accessStore()) {
  await store.upsertUser({ id: profile.sub, email: profile.email, name: profile.name });
  const sid = randomBytes(18).toString('base64url');
  await store.startSession(profile.sub, sid);
  forgetAccess(profile.sub);
  await startSession({ ...profile, sid });
}

/** The signed-in session and its account, only while it is still the account's active session. */
export async function activeSession(store: AccessStore = accessStore()) {
  const session = await readSession();
  if (!session?.sid) return null;
  const user = await store.getUser(session.sub);
  return user && user.sessionId === session.sid ? { session, user } : null;
}
