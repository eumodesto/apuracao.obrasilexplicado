import { activeSession } from '@/lib/access/auth';
import { accessStore } from '@/lib/access/store';
import { cleanUsername, usernameProblem } from '@/lib/profile/username';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Live check while the username is typed at sign-up. */
export async function GET(request: Request) {
  const active = await activeSession();
  if (!active) return Response.json({ error: 'Faça login para continuar.' }, { status: 401 });
  const username = cleanUsername(new URL(request.url).searchParams.get('u') ?? '');
  const problem = usernameProblem(username);
  if (problem) return Response.json({ available: false, message: problem });
  const taken = await accessStore().usernameTaken(username, active.user.id);
  return Response.json(
    { available: !taken, message: taken ? 'Esse nome já está em uso. Escolha outro.' : null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
