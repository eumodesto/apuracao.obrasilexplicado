import { createHash } from 'node:crypto';
import { history } from '@/lib/tse/history';
import { withAccess } from '@/lib/access/guard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function get(request: Request) {
  if (new URL(request.url).searchParams.size)
    return Response.json(
      { error: 'O histórico corresponde ao resultado nacional presidencial.' },
      { status: 400 },
    );
  const data = await history.read();
  const etag = '"' + createHash('sha256').update(JSON.stringify(data)).digest('hex') + '"';
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' };
  return request.headers.get('if-none-match') === etag
    ? new Response(null, { status: 304, headers })
    : Response.json(data, { headers });
}
export const GET = withAccess(get);
