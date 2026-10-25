import { createHash } from 'node:crypto';
import { president, QueryError } from '@/lib/tse/service';
import { encodeBody, respondBody, sharedValue } from '@/lib/tse/snapshot-response';
import { withAccess } from '@/lib/access/guard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The answer is the same for every viewer of a query: one build per window (the TSE moves ~30 s). */
const SHARED_MS = 2_000;

async function get(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (new Set(params.keys()).size !== Array.from(params.keys()).length)
      throw new QueryError('Filtros duplicados.');
    const key =
      'president:' +
      [...params]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    const shared = await sharedValue(key, SHARED_MS, async () => {
      const data = await president(Object.fromEntries(params));
      const etag =
        '"' +
        createHash('sha256')
          .update(
            JSON.stringify({
              snapshot: data.snapshot,
              stale: data.stale,
              issue: data.issue,
              status: data.status,
            }),
          )
          .digest('hex') +
        '"';
      return encodeBody(JSON.stringify(data), etag, {
        'Cache-Control': 'private, no-cache',
        'X-Poll-After': String(data.nextPollMs),
        'X-TSE-Checked-At': data.checkedAt ?? '',
        'X-TSE-Attempted-At': data.attemptedAt ?? '',
      });
    });
    return respondBody(request, shared);
  } catch (error) {
    if (error instanceof QueryError)
      return Response.json({ error: error.message }, { status: 400 });
    console.error('[TSE] internal service failure');
    return Response.json({ error: 'Não foi possível consultar a fonte oficial.' }, { status: 503 });
  }
}
export const GET = withAccess(get);
