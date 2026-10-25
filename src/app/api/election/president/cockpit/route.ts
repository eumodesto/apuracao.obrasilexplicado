import { cachedSnapshotResponse, snapshotResponse } from '@/lib/tse/snapshot-response';
import { cockpitHistory } from '@/lib/tse/cockpit-history';
import { knownMunicipalities } from '@/lib/tse/municipal-map';
import { president } from '@/lib/tse/service';
import { electionMap } from '@/lib/tse/map-service';
import { withAccess } from '@/lib/access/guard';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The latest cockpit is the same for every viewer: build and encode it once per window. */
const SHARED_MS = 3_000;

/** `id` null is the live frame; a missing historical frame yields null. */
async function build(id: string | null) {
  if (!id) {
    const [national, map] = await Promise.all([president({}), electionMap()]);
    await cockpitHistory.record(national, map.snapshot, knownMunicipalities());
  }
  const frames = await cockpitHistory.read();
  const frame = id ? frames.find((f) => f.id === id) : frames.at(-1);
  if (id && !frame) return null;
  return {
    frame: frame ?? null,
    timeline: frames.map((f) => ({
      id: f.id,
      observedAt: f.observedAt,
      officialAt:
        f.national.snapshot?.progress.totaledAt ?? f.national.snapshot?.progress.generatedAt,
      counted: f.national.snapshot?.progress.percentageCounted,
      sections: f.national.snapshot?.progress.countedSections,
      candidates: f.national.analysis?.candidates ?? [],
    })),
    durable: cockpitHistory.durable,
    temporary: !!process.env.VERCEL,
  };
}

async function get(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('frame');
  if ([...params.keys()].some((k) => k !== 'frame') || (id && !/^[a-f0-9]{20}$/.test(id)))
    return Response.json({ error: 'Momento inválido' }, { status: 400 });
  if (!id) return cachedSnapshotResponse(request, 'cockpit:live', SHARED_MS, () => build(null));
  const payload = await build(id);
  if (!payload)
    return Response.json({ error: 'Momento não disponível nesta instância' }, { status: 404 });
  return snapshotResponse(request, payload);
}
export const GET = withAccess(get);
