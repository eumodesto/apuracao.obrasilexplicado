import { isAdmin } from '@/lib/access/access';
import { chatAccess } from '@/lib/chat/access';
import { connectStream, encodeEvent, history, onlineCount } from '@/lib/chat/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PING_MS = 20_000;
/** How often an open connection re-checks the session (another device, free time over). */
const RECHECK_MS = 20_000;

/**
 * Live chat over Server-Sent Events: the latest messages first, then every new message,
 * deletion and the number of people online.
 */
export async function GET(request: Request) {
  const chat = await chatAccess();
  if (chat.problem) return chat.problem;
  const { session } = chat;
  // Administrators also get a delete button on every message.
  const moderator = isAdmin(chat.access.user);
  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const enqueue = (chunk: Uint8Array) => {
        if (!open) return;
        try {
          controller.enqueue(chunk);
        } catch {
          stop();
        }
      };
      const write = (text: string) => enqueue(encoder.encode(text));
      const send = (event: string, data: unknown) => write(encodeEvent(event, data));

      // New messages and deletions arrive in shared, already encoded batches.
      const disconnect = connectStream(enqueue);
      const timers = [
        setInterval(() => write(': ping\n\n'), PING_MS),
        setInterval(async () => {
          send('online', { online: await onlineCount() });
          const again = await chatAccess({ session }).catch(() => null);
          if (!again || again.problem) {
            const body = again?.problem ? await again.problem.json().catch(() => ({})) : {};
            send('end', { code: body.code ?? 'error' });
            stop();
          } else send('access', { canWrite: again.canWrite });
        }, RECHECK_MS),
      ];
      stop = () => {
        if (!open) return;
        open = false;
        timers.forEach(clearInterval);
        disconnect();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      request.signal.addEventListener('abort', () => stop());

      try {
        send('hello', {
          messages: await history(),
          online: await onlineCount(),
          me: chat.author.username,
          photo: chat.author.photo,
          party: chat.author.party,
          canWrite: chat.canWrite,
          moderator,
        });
      } catch (error) {
        console.error('[chat] history unavailable', error);
        send('hello', {
          messages: [],
          online: 0,
          me: chat.author.username,
          photo: chat.author.photo,
          party: chat.author.party,
          canWrite: chat.canWrite,
          moderator,
        });
      }
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx-style proxies not to buffer the stream.
      'X-Accel-Buffering': 'no',
    },
  });
}
