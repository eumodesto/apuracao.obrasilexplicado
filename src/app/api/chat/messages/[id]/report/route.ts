import { chatAccess } from '@/lib/chat/access';
import { reportMessage } from '@/lib/chat/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Flags a message for the moderators. One report per person per message. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const chat = await chatAccess();
  if (chat.problem) return chat.problem;
  const { id } = await params;
  if (!/^[a-z0-9]{8,40}$/.test(id))
    return Response.json({ error: 'Mensagem inválida.' }, { status: 400 });
  const result = await reportMessage(id, chat.author.userId);
  if (result === 'missing')
    return Response.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
  return Response.json({ ok: true, already: result === 'already' });
}
