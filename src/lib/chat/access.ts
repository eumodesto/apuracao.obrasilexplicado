import { currentAccess, sessionProblem } from '@/lib/access/guard';
import { readSession, type Session } from '@/lib/access/session';
import { NO_PARTY } from '@/lib/profile/parties';
import { photoRef } from '@/lib/profile/photo';
import type { Author } from './service';

/**
 * Who may use the chat: signed-in, signed-up, on their active session and not locked out.
 * Reading is open to free time; writing needs paid (or team) access.
 */
export async function chatAccess(options: { fresh?: boolean; session?: Session | null } = {}) {
  const session = options.session === undefined ? await readSession() : options.session;
  const access = await currentAccess(session, undefined, undefined, { fresh: options.fresh });
  const problem = sessionProblem(access);
  if (problem || !access) return { problem: problem! };
  if (access.status.state === 'locked')
    return {
      problem: Response.json(
        { error: 'O tempo gratuito acabou.', code: 'locked' },
        { status: 402 },
      ),
    };
  const author: Author = {
    userId: access.user.id,
    username: access.user.username!,
    party: access.user.party && access.user.party !== NO_PARTY ? access.user.party : null,
    photo: photoRef(access.user),
  };
  return { access, author, session: session!, canWrite: access.status.state === 'paid' };
}
