import { createHash } from 'node:crypto';
import { zones } from '@/lib/tse/zones';
import { QueryError } from '@/lib/tse/service';
import { withAccess } from '@/lib/access/guard';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
async function get(request: Request) {
  const p = new URL(request.url).searchParams,
    uf = (p.get('state') ?? '').toLowerCase(),
    town = p.get('municipality') ?? '';
  if (
    !/^[a-z]{2}$/.test(uf) ||
    uf === 'zz' ||
    !/^\d{5}$/.test(town) ||
    [...p.keys()].some((k) => !['state', 'municipality'].includes(k))
  )
    return Response.json({ error: 'Filtros inválidos' }, { status: 400 });
  try {
    const data = await zones(uf, town),
      etag = '"' + createHash('sha256').update(JSON.stringify(data)).digest('hex') + '"',
      headers = { ETag: etag, 'Cache-Control': 'private, no-cache' };
    return request.headers.get('if-none-match') === etag
      ? new Response(null, { status: 304, headers })
      : Response.json(data, { headers });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof QueryError ? error.message : 'Zonas temporariamente indisponíveis',
      },
      { status: error instanceof QueryError ? 400 : 503 },
    );
  }
}
export const GET = withAccess(get);
