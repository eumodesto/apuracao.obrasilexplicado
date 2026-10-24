import { chat } from '@/lib/chat/service';
import { cleanEmail, notifyStore } from '@/lib/notify/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** "Me avise": stores the e-mail to warn when the count starts. Public, rate limited per IP. */
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  // Shared across servers through the same Redis slot mechanism as the chat's slow mode.
  if (!(await chat().bus.claim(`notify:${ip}`, 3_000)))
    return Response.json({ error: 'Espere alguns segundos e tente de novo.' }, { status: 429 });
  const body = await request.json().catch(() => null);
  const email = cleanEmail(body?.email);
  if (!email) return Response.json({ error: 'Digite um e-mail válido.' }, { status: 400 });
  try {
    const result = await notifyStore().add(email, Date.now());
    return Response.json({ ok: true, already: result === 'exists' });
  } catch (error) {
    console.error('[notify] signup failed', error);
    return Response.json({ error: 'Não foi possível salvar. Tente de novo.' }, { status: 503 });
  }
}
