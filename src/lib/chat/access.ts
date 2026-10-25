import { currentAccess, sessionProblem } from '@/lib/access/guard';
import { readSession, type Session } from '@/lib/access/session';
import { NO_PARTY } from '@/lib/profile/parties';
import { photoRef } from '@/lib/profile/photo';
import type { Author } from './service';

/**
 * Who may use the chat: signed-in, signed-up, on their active session and not locked out.
 * Free time (visitors included) reads and writes. Free stickers are included; party packs need
 * paid access and a credit.
 */
export async function chatAccess(options: { fresh?: boolean; session?: Session | null } = {}) {
  const session = options.session === undefined ? await readSession() : options.session;
  const access = await currentAccess(session, undefined, undefined, { fresh: options.fresh });
  const problem = sessionProblem(access);
  if (problem || !access) return { problem: problem! };
  if (access.status.state === 'locked')
    return {
      problem: Response.json(
        {
          error: access.status.guest
            ? 'Crie sua conta para continuar.'
            : 'Libere o acesso para continuar.',
          code: access.status.guest ? 'signup' : 'payment_required',
        },
        { status: 402 },
      ),
    };
  const author: Author = {
    userId: access.user.id,
    username: access.user.username!,
    party: access.user.party && access.user.party !== NO_PARTY ? access.user.party : null,
    photo: photoRef(access.user),
  };
  return {
    access,
    author,
    session: session!,
    canWrite: true,
    /** Paid or team access: may use stickers (team without spending). */
    paid: access.status.state === 'paid',
  };
}
