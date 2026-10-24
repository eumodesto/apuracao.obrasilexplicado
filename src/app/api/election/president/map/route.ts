import { createHash } from 'node:crypto';
import { electionMap } from '@/lib/tse/map-service';
import { CLIENT_POLL_MS } from '@/lib/tse/service';
import { withAccess } from '@/lib/access/guard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function get(request: Request) {
  if (new URL(request.url).searchParams.size)
    return Response.json(
      { error: 'O mapa utiliza somente a abrangência Brasil.' },
      { status: 400 },
    );
  try {
    const data = await electionMap();
    const etag =
      '"' + createHash('sha256').update(JSON.stringify(data.snapshot)).digest('hex') + '"';
    const headers = {
      'Cache-Control': 'private, no-cache',
      ETag: etag,
      'X-Poll-After': String(Math.max(CLIENT_POLL_MS, data.nextPollMs)),
    };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    return Response.json(data, { headers });
  } catch (error) {
    console.warn(
      '[TSE] map aggregation failed; client keeps previous snapshot',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return Response.json({ error: 'O mapa está temporariamente indisponível.' }, { status: 503 });
  }
}
export const GET = withAccess(get);
