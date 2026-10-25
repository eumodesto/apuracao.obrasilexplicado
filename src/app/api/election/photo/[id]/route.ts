import { firstRoundNational } from '@/lib/tse/first-round';
import { governorCandidate } from '@/lib/tse/governors';
import { client, president } from '@/lib/tse/service';
type Photo = { bytes: ArrayBuffer; type: string };
const photos = new Map<string, Photo>();
const pending = new Map<string, Promise<Photo | null>>();
const retryAt = new Map<string, number>();
let queue = Promise.resolve();
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) return new Response(null, { status: 400 });
  if (!photos.has(id) && !pending.has(id)) {
    if (Date.now() < Math.max(retryAt.get(id) ?? 0, client.cooldownUntil))
      return new Response(null, { status: 503 });
    const flight = (async () => {
      const data = await president({});
      // Candidates of the active round (President and governor runoffs), or of the 1st round.
      const candidate =
        data.snapshot?.candidates.find((c) => c.id === id) ??
        (await firstRoundNational().catch(() => null))?.candidates.find((c) => c.id === id) ??
        (await governorCandidate(id).catch(() => null));
      if (!candidate) return null;
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (Date.now() < client.cooldownUntil) return null;
        const r = await fetch(candidate.imageUrl, {
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        });
        if (!r.ok) {
          retryAt.set(id, Date.now() + (r.status === 404 ? 600_000 : 60_000));
          // Only share cooldown with JSON fetches on rate-limit style responses.
          // A missing candidate photo must never pause the national TSE feed.
          if (r.status === 429 || r.status === 403) {
            const retry = r.headers.get('retry-after');
            let delay = 0;
            if (retry) {
              if (/^\d+$/.test(retry)) delay = Number(retry) * 1000;
              else {
                const until = Date.parse(retry) - Date.now();
                delay = Number.isFinite(until) ? Math.max(0, until) : 0;
              }
            }
            client.pause(Math.max(610_000, delay));
          }
          return null;
        }
        const type = r.headers.get('content-type') ?? '';
        if (!type.startsWith('image/jpeg')) return null;
        const bytes = await r.arrayBuffer();
        if (bytes.byteLength > 2_000_000) return null;
        const photo = { bytes, type };
        photos.set(id, photo);
        return photo;
      } catch {
        retryAt.set(id, Date.now() + 60000);
        return null;
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 250));
        release();
      }
    })();
    pending.set(id, flight);
    void flight.finally(() => pending.delete(id));
  }
  const photo = photos.get(id) ?? (await pending.get(id));
  return photo
    ? new Response(photo.bytes, {
        headers: {
          'Content-Type': photo.type,
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    : new Response(null, { status: 404 });
}
