import { catalog, client, CLIENT_POLL_MS, POLL_MS, president, STALE_MS } from './service';
import { resultUrl, trackingUrl } from './urls';
import { trackingSchema } from './schemas';
import { officialDate } from './normalizers';
import { MapCoordinator, type TrackingSignals } from './map-coordinator';
import definitions from './map-geography.json';
import type { ElectionConfig, ElectionResponse, ElectionSnapshot, Scope } from './types';
let configuration: ElectionConfig | null = null;
const runtime = globalThis as typeof globalThis & { tseMapCoordinator?: MapCoordinator };
function cachedState(uf: string): ElectionResponse | null {
  if (!configuration) return null;
  const scope: Scope = { type: 'state', code: uf, state: uf, name: uf };
  const cached = client.peek<ElectionSnapshot>(resultUrl(configuration, scope));
  if (!cached) return null;
  return {
    snapshot: cached.value,
    status: cached.value?.status ?? 'unavailable',
    stale: !!cached.issue,
    issue: cached.issue ? 'Os dados oficiais estão temporariamente indisponíveis.' : null,
    checkedAt: cached.checkedAt ? new Date(cached.checkedAt).toISOString() : null,
    nextPollMs: CLIENT_POLL_MS,
  };
}
async function tracking(): Promise<TrackingSignals> {
  const { config } = await catalog();
  if (!config.value) return { signals: {}, issue: 'Configuration unavailable' };
  configuration = config.value;
  const resource = await client.read(
    trackingUrl(config.value, 'br'),
    (raw) => {
      const data = trackingSchema.parse(raw);
      if (data.ele !== config.value!.election) throw new Error('Unexpected tracking election');
      return Object.fromEntries(
        data.abr
          .filter((a) => a.tpabr === 'uf' && a.cdabr !== 'zz')
          .map((a) => [
            a.cdabr,
            `${officialDate(a.dt ?? '', a.ht ?? '') ?? ''}|${a.s.st}|${a.and}`,
          ]),
      );
    },
    POLL_MS,
  );
  return { signals: resource.value ?? {}, issue: resource.issue };
}
// Recreate only after a development module reload changes the class; normal
// requests keep the same process-wide coordinator and its cache.
export const mapCoordinator = (runtime.tseMapCoordinator =
  runtime.tseMapCoordinator instanceof MapCoordinator
    ? runtime.tseMapCoordinator
    : new MapCoordinator(
        {
          geography: async () => {
            const { config, geography } = await catalog();
            configuration = config.value;
            return geography?.value ?? [];
          },
          national: () => president({}),
          tracking,
          state: (uf) => president({ state: uf }),
          cachedState,
        },
        definitions,
        POLL_MS,
        STALE_MS,
      ));
mapCoordinator.serveStale = true;
export const electionMap = () => mapCoordinator.read();
