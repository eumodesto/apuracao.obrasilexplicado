import { forgetAccess } from '@/lib/access/guard';
import { accessStore } from '@/lib/access/store';
import { chatAccess } from '@/lib/chat/access';
import { sendMessage, sendSticker } from '@/lib/chat/service';
import { isFreeSticker, stickerById } from '@/lib/chat/stickers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Sends a chat message or sticker. Text and free stickers: anyone with access (free minute
 * included). Paid/party stickers: paid access, one credit each (the team sends without spending).
 */
export async function POST(request: Request) {
  const chat = await chatAccess({ fresh: true });
  if (chat.problem) return chat.problem;
  const body = await request.json().catch(() => null);
  let stickers: number | null = null;
  let result;
  if (body?.sticker !== undefined) {
    const catalog = typeof body.sticker === 'string' ? stickerById(body.sticker) : null;
    const free = isFreeSticker(catalog);
    if (!free && !chat.paid)
      return Response.json(
        { error: 'Figurinhas exclusivas são para quem liberou o acesso.', code: 'payment_required' },
        { status: 402 },
      );
    const complimentary = chat.access.status.staff || chat.access.status.granted;
    result = await sendSticker(chat.author, body.sticker, undefined, undefined, async () => {
      if (free || complimentary) return true;
      stickers = await accessStore().useStickerCredit(chat.author.userId);
      // The balance shown on the next page load comes from the database, not a cached copy.
      forgetAccess(chat.author.userId);
      return stickers !== null;
    });
  } else result = await sendMessage(chat.author, body?.text);
  if (!result.ok)
    return Response.json(
      { error: result.error, retryAfterMs: result.retryAfterMs, code: result.code },
      { status: result.status },
    );
  return Response.json({ message: result.message, stickers }, { status: 201 });
}
