import { withAdmin } from '@/lib/admin/guard';
import { chat } from '@/lib/chat/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Reported messages still visible, most reported first. */
export const GET = withAdmin(async () => {
  const reported = await chat().store.reported(100);
  return Response.json(
    {
      reports: reported.map(({ message, reports }) => ({
        id: message.id,
        userId: message.userId,
        username: message.username,
        party: message.party,
        photo: message.photo,
        text: message.text,
        sticker: message.sticker,
        createdAt: message.createdAt,
        reports,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
