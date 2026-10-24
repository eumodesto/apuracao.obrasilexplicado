import { snapshotResponse } from '@/lib/tse/snapshot-response';
import { cachedMunicipalities, municipalities } from '@/lib/tse/municipal-map';
import { withAccess } from '@/lib/access/guard';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
async function get(request: Request) {
  const params = new URL(request.url).searchParams;
  const uf = params.get('state')?.toLowerCase() ?? '';
  if (!/^[a-z]{2}$/.test(uf) || uf === 'zz' || [...params.keys()].some((k) => k !== 'state'))
    return Response.json({ error: 'UF inválida' }, { status: 400 });
  try {
    const data = await (uf === 'br' ? cachedMunicipalities() : municipalities(uf));
    return snapshotResponse(request, data);
  } catch {
    return Response.json(
      { error: 'Dados municipais temporariamente indisponíveis' },
      { status: 503 },
    );
  }
}
export const GET = withAccess(get);
