import { chatAccess } from '@/lib/chat/access';
import { sendMessage } from '@/lib/chat/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Sends a chat message. Only paid (or team) accounts write; free time is read-only. */
export async function POST(request: Request) {
  const chat = await chatAccess({ fresh: true });
  if (chat.problem) return chat.problem;
  if (!chat.canWrite)
    return Response.json(
      { error: 'Libere o acesso para escrever no chat.', code: 'payment_required' },
      { status: 402 },
    );
  const body = await request.json().catch(() => null);
  const result = await sendMessage(chat.author, body?.text);
  if (!result.ok)
    return Response.json(
      { error: result.error, retryAfterMs: result.retryAfterMs },
      { status: result.status },
    );
  return Response.json({ message: result.message }, { status: 201 });
}
