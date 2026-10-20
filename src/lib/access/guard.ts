import { accessStatus } from './access';
import { MAX_ACTIVITY_GAP_SECONDS } from './config';
import { readSession, type Session } from './session';
import { accessStore } from './store';
import type { AccessStore } from './types';

/** Records activity for the signed-in user and returns their access, or null without a session. */
export async function currentAccess(
  session: Session | null,
  store: AccessStore = accessStore(),
  now = Date.now(),
) {
  if (!session) return null;
  const user =
    (await store.touch(session.sub, now, MAX_ACTIVITY_GAP_SECONDS)) ??
    (await store.upsertUser({ id: session.sub, email: session.email, name: session.name }));
  return { user, status: accessStatus(user, now) };
}

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
