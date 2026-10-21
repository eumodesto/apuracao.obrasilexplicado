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
/**
 * Paid accounts have no free time to count: their record is only re-read (sessions, moderation)
 * every PAID_CHECK_MS, and `lastSeenAt` (shown to the moderators) is written every PAID_TOUCH_MS.
 * At 5,000 paying viewers this took most of the database's work in the load test.
 */
export const PAID_CHECK_MS = 30_000;
export const PAID_TOUCH_MS = 5 * 60_000;
// On globalThis: pages and route handlers may load this module separately, and a payment or a
// moderation step that forgets an account must reach every copy.
const shared = globalThis as {
  __recentAccess?: Map<string, { user: AccessUser; store: AccessStore; checkedAt: number }>;
};
const recent = (shared.__recentAccess ??= new Map());

/** Records activity for the signed-in user and returns their access, or null without a session. */
export async function currentAccess(
  session: Session | null,
  store: AccessStore = accessStore(),
  now = Date.now(),
  options: { started?: boolean; fresh?: boolean } = {},
) {
  if (!session) return null;
  const started = options.started ?? (await countStarted(now));
  const cached = recent.get(session.sub)?.store === store ? recent.get(session.sub) : undefined;
  const paid = cached?.user.paidAt != null;
  let user = !cached
    ? null
    : paid
      ? now - cached.checkedAt < PAID_CHECK_MS
        ? cached.user
        : null
      : !options.fresh &&
          cached.user.lastSeenAt !== null &&
          now - cached.user.lastSeenAt < TOUCH_INTERVAL_MS
        ? cached.user
        : null;
  if (!user) {
    const write = !paid || now - (cached?.user.lastSeenAt ?? 0) >= PAID_TOUCH_MS;
    user =
      (write
        ? await store.touch(session.sub, now, MAX_ACTIVITY_GAP_SECONDS, started)
        : await store.getUser(session.sub)) ??
      (await store.upsertUser({ id: session.sub, email: session.email, name: session.name }));
    if (recent.size > 50_000) recent.clear();
    recent.set(session.sub, { user, store, checkedAt: now });
  }
  return {
    user,
    status: accessStatus(user, now, undefined, !started),
    /** Another device signed in with this account after this session started. */
    replaced: !session.sid || user.sessionId !== session.sid,
    onboarded: user.onboardedAt !== null,
    /** Suspended or deleted by the moderators. */
    blocked: user.deletedAt ? ('deleted' as const) : user.pausedAt ? ('paused' as const) : null,
  };
}

/** API answer for a session that can no longer be used, or null when it can. */
export function sessionProblem(
  access: { replaced: boolean; onboarded: boolean; blocked: 'paused' | 'deleted' | null } | null,
) {
  if (!access) return Response.json({ error: 'Faça login para continuar.' }, { status: 401 });
  if (access.replaced)
    return Response.json(
      { error: 'Sua conta foi conectada em outro aparelho.', code: 'replaced' },
      { status: 401 },
    );
  if (access.blocked)
    return Response.json(
      {
        error:
          access.blocked === 'deleted' ? 'Esta conta foi excluída.' : 'Sua conta está suspensa.',
        code: access.blocked,
      },
      { status: 403 },
    );
  if (!access.onboarded)
    return Response.json(
      { error: 'Conclua o cadastro para continuar.', code: 'onboarding' },
      { status: 403 },
    );
  return null;
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
    const problem = sessionProblem(access);
    if (problem || !access) return problem!;
    if (access.status.state === 'locked')
      return Response.json(
        { error: 'O tempo gratuito acabou.', access: access.status },
        { status: 402 },
      );
    return handler(request, context);
  };
}
