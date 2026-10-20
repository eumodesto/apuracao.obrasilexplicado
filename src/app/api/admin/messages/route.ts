import { withAdmin } from '@/lib/admin/guard';
import { chat } from '@/lib/chat/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Latest chat messages with their authors' account ids, newest first. */
export const GET = withAdmin(async () => {
  const messages = await chat().store.recent(150);
  return Response.json(
    {
      messages: messages
        .reverse()
        .map(({ id, userId, username, party, photo, text, sticker, createdAt }) => ({
          id,
          userId,
          username,
          party,
          photo,
          text,
          sticker,
          createdAt,
        })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
