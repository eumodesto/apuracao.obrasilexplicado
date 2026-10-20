import { accessStatus } from './access';
import { MAX_ACTIVITY_GAP_SECONDS } from './config';
import { countStarted } from './live';
import { readSession, type Session } from './session';
import { accessStore } from './store';
import type { AccessStore, AccessUser } from './types';

/**
 * Data requests arrive every few seconds per panel. Writing each one would flood the database at
 * peak, so a request within this window reuses the last record instead. No time is lost: the next
 * write still counts the whole gap since `lastSeenAt` (capped at MAX_ACTIVITY_GAP_SECONDS).
 */
export const TOUCH_INTERVAL_MS = 5_000;
const recent = new Map<string, { user: AccessUser; store: AccessStore }>();

/** Records activity for the signed-in user and returns their access, or null without a session. */
export async function currentAccess(
  session: Session | null,
  store: AccessStore = accessStore(),
  now = Date.now(),
  options: { started?: boolean; fresh?: boolean } = {},
) {
  if (!session) return null;
  const started = options.started ?? (await countStarted(now));
  const cached = recent.get(session.sub);
  let user =
    !options.fresh &&
    cached?.store === store &&
    cached.user.lastSeenAt !== null &&
    now - cached.user.lastSeenAt < TOUCH_INTERVAL_MS
      ? cached.user
      : null;
  if (!user) {
    user =
      (await store.touch(session.sub, now, MAX_ACTIVITY_GAP_SECONDS, started)) ??
      (await store.upsertUser({ id: session.sub, email: session.email, name: session.name }));
    if (recent.size > 50_000) recent.clear();
    recent.set(session.sub, { user, store });
  }
  return { user, status: accessStatus(user, now, undefined, !started) };
}

/** Drops the cached record, e.g. right after a payment changes it. */
export const forgetAccess = (userId: string) => recent.delete(userId);

type Handler<C> = (request: Request, context: C) => Promise<Response>;

/** Election data is only served to signed-in users with free time left or paid access. */
export function withAccess<C>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    let access;
    try {
      access = await currentAccess(await readSession());
    } catch (error) {
      console.error('[access] check failed', error);
      return Response.json({ error: 'Não foi possível verificar o acesso.' }, { status: 503 });
    }
    if (!access) return Response.json({ error: 'Faça login para continuar.' }, { status: 401 });
    if (access.status.state === 'locked')
      return Response.json(
        { error: 'O tempo gratuito acabou.', access: access.status },
        { status: 402 },
      );
    return handler(request, context);
  };
}
