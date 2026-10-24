import { accessStore } from '@/lib/access/store';
import { withAdmin } from '@/lib/admin/guard';
import { chat, onlineCount } from '@/lib/chat/service';
import { notifyStore } from '@/lib/notify/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withAdmin(async () => {
  const [stats, online, signups, reports] = await Promise.all([
    accessStore().stats(),
    onlineCount(),
    notifyStore().list(),
    chat().store.reported(500),
  ]);
  return Response.json(
    { ...stats, online, notifySignups: signups.length, reportedMessages: reports.length },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
