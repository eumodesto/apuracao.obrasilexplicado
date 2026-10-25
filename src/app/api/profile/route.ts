import { activeSession } from '@/lib/access/auth';
import { forgetAccess } from '@/lib/access/guard';
import { checkEmail } from '@/lib/access/password';
import { accessStore } from '@/lib/access/store';
import { NO_PARTY, validPartyChoice } from '@/lib/profile/parties';
import { cleanUsername, usernameProblem } from '@/lib/profile/username';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Saves the sign-up profile: unique username, party and the LGPD consent for the party. */
export async function POST(request: Request) {
  const active = await activeSession();
  if (!active) return Response.json({ error: 'Faça login para continuar.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const username = cleanUsername(String(body?.username ?? ''));
  const party = String(body?.party ?? '');
  const problem = usernameProblem(username);
  if (problem) return Response.json({ field: 'username', error: problem }, { status: 400 });
  if (!validPartyChoice(party))
    return Response.json({ field: 'party', error: 'Escolha uma opção.' }, { status: 400 });
  // Political opinion is sensitive data (LGPD art. 11): store it only with explicit consent.
  if (party !== NO_PARTY && body?.consent !== true)
    return Response.json(
      { field: 'consent', error: 'Marque a autorização para mostrar o partido no chat.' },
      { status: 400 },
    );
  const store = accessStore();
  // Username accounts created before e-mail was required still need one for Pix.
  if (!active.user.email?.trim()) {
    const checked = checkEmail(body?.email);
    if (!checked.ok)
      return Response.json({ field: 'email', error: checked.error }, { status: 400 });
    await store.upsertUser({
      id: active.user.id,
      email: checked.email,
      name: active.user.name || username,
    });
  }
  const now = Date.now();
  const result = await store.saveProfile(
    active.user.id,
    { username, party, partyConsentAt: party === NO_PARTY ? null : now },
    now,
  );
  if (result === 'taken')
    return Response.json(
      { field: 'username', error: 'Esse nome já está em uso. Escolha outro.' },
      { status: 409 },
    );
  if (result === 'missing')
    return Response.json({ error: 'Faça login para continuar.' }, { status: 401 });
  forgetAccess(active.user.id);
  return Response.json({ ok: true });
}
