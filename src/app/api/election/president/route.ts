import { createHash } from 'node:crypto';
import { president, QueryError } from '@/lib/tse/service';
import { withAccess } from '@/lib/access/guard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function get(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (new Set(params.keys()).size !== Array.from(params.keys()).length)
      throw new QueryError('Filtros duplicados.');
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
    const headers = {
      'Cache-Control': 'private, no-cache',
      ETag: etag,
      'X-Poll-After': String(data.nextPollMs),
      'X-TSE-Checked-At': data.checkedAt ?? '',
      'X-TSE-Attempted-At': data.attemptedAt ?? '',
    };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    return Response.json(data, { headers });
  } catch (error) {
    if (error instanceof QueryError)
      return Response.json({ error: error.message }, { status: 400 });
    console.error('[TSE] internal service failure');
    return Response.json({ error: 'Não foi possível consultar a fonte oficial.' }, { status: 503 });
  }
}
export const GET = withAccess(get);
