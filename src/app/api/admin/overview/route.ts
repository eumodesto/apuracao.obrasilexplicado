import { accessStore } from '@/lib/access/store';
import { withAdmin } from '@/lib/admin/guard';
import { chat, onlineCount } from '@/lib/chat/service';
import { notifyStore } from '@/lib/notify/store';
import { cachedSnapshot } from '@/lib/tse/snapshot-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The totals scan every user; moderators polling together share one result for a few seconds. */
const SHARED_MS = 5_000;

export const GET = withAdmin(async () => {
  const encoded = await cachedSnapshot('admin:overview', SHARED_MS, async () => {
    const [stats, online, signups, reports] = await Promise.all([
      accessStore().stats(),
      onlineCount(),
      notifyStore().list(),
      chat().store.reported(500),
    ]);
    return { ...stats, online, notifySignups: signups.length, reportedMessages: reports.length };
  });
  return new Response(encoded.identity as Uint8Array<ArrayBuffer>, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});
