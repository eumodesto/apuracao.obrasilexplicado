import { catalog, client, president, POLL_MS } from './service';
import { resultUrl } from './urls';
import { candidateColor } from './candidate-colors';
import { normalizeResult } from './normalizers';
import { municipalBaseline } from './municipal-baseline';
import type { ElectionSnapshot } from './types';
export type MunicipalMetric = {
  code: string;
  name: string;
  uf: string;
  version: string;
  updatedAt: string;
  counted: number;
  validVotes: number | null;
  candidates: {
    id: string;
    number: string;
    name: string;
    votes: number;
    percentage: number;
    color: string;
  }[];
  stale: boolean;
};
export function municipalMetric(s: ElectionSnapshot, stale = false): MunicipalMetric {
  return {
    code: s.scope.code,
    name: s.scope.name,
    uf: s.scope.state,
    version: s.version,
    updatedAt: s.progress.totaledAt ?? s.progress.generatedAt,
    counted: s.progress.percentageCounted,
    validVotes: s.progress.validVotes,
    stale,
    candidates: s.candidates.map((c) => ({
      id: c.id,
      number: c.number,
      name: c.ballotName,
      votes: c.votes,
      percentage: c.percentage,
      color: candidateColor(c),
    })),
  };
}
const runtime = globalThis as typeof globalThis & {
  municipalFlights?: Map<string, Promise<unknown>>;
  municipalCursors?: Map<string, number>;
};
const flights = (runtime.municipalFlights ??= new Map());
const cursors = (runtime.municipalCursors ??= new Map());
const knownRuntime = globalThis as typeof globalThis & {
  municipalKnown?: Map<string, MunicipalMetric>;
};
const known = (knownRuntime.municipalKnown ??= new Map());
function remember(metric: MunicipalMetric) {
  const previous = known.get(metric.uf + metric.code);
  if (!previous || Date.parse(metric.updatedAt) >= Date.parse(previous.updatedAt))
    known.set(metric.uf + metric.code, metric);
}
let baselineRestored = false;
let knownElection: string | null = null;
/** Starts over when the active election changes (1st → 2nd round), so results never mix. */
async function restoreBaseline() {
  const { config } = await catalog();
  const election = config.value?.election;
  if (!election) return;
  if (knownElection !== election) {
    known.clear();
    baselineRestored = false;
    knownElection = election;
  }
  if (baselineRestored) return;
  const results = await municipalBaseline(election);
  for (const metric of results) remember(metric);
  baselineRestored = true;
}
export const knownMunicipalities = () =>
  [...known.values()].sort((a, b) => (a.uf + a.code).localeCompare(b.uf + b.code));
export async function cachedMunicipalities() {
  await restoreBaseline();
  const { config, geography } = await catalog();
  if (!config.value || !geography?.value) throw new Error('Catálogo indisponível');
  let total = 0;
  for (const region of geography.value.filter((r) => r.code !== 'zz')) {
    total += region.municipalities.length;
    for (const town of region.municipalities) {
      const scope = {
        type: 'municipality' as const,
        state: region.code,
        code: town.code,
        name: town.name,
      };
      const url = resultUrl(config.value, scope);
      const entry = await client.restore(url, (raw) =>
        normalizeResult(raw, config.value!, scope, url),
      );
      if (entry?.value) remember(municipalMetric(entry.value, !!entry.issue));
    }
  }
  const results = knownMunicipalities();
  return {
    uf: 'br',
    total,
    available: results.length,
    results,
    nextPollMs: 30000,
    progressive: results.length < total,
  };
}
const latest = new Map<string, Awaited<ReturnType<typeof read>>>();
const startedAt = new Map<string, number>();
/** Background batches per UF start at most this often, so they never crowd the TSE queue. */
const REFRESH_MS = 30_000;
/**
 * After a UF's first answer, readers get the latest one at once while the next batch of
 * municipalities is collected in the background (a batch can take up to 12 s of TSE reads).
 */
export async function municipalities(uf: string) {
  let pending = flights.get(uf) as ReturnType<typeof read> | undefined;
  const previous = latest.get(uf);
  if (!pending && previous && Date.now() - (startedAt.get(uf) ?? 0) < REFRESH_MS) return previous;
  if (!pending) {
    startedAt.set(uf, Date.now());
    pending = read(uf)
      .then((result) => {
        latest.set(uf, result);
        return result;
      })
      .finally(() => flights.delete(uf));
    flights.set(uf, pending);
  }
  if (previous) {
    pending.catch(() => {});
    return previous;
  }
  return pending;
}
async function read(uf: string) {
  await restoreBaseline();
  const { config, geography } = await catalog();
  const region = geography?.value?.find((g) => g.code === uf);
  if (!config.value || !region || uf === 'zz') throw new Error('UF indisponível');
  const cursor = cursors.get(uf) ?? 0;
  // Load every previously validated result, including those acquired by the finite collector.
  for (const town of region.municipalities) {
    const scope = { type: 'municipality' as const, state: uf, code: town.code, name: town.name };
    const url = resultUrl(config.value, scope);
    await client.restore(url, (raw) => normalizeResult(raw, config.value!, scope, url));
  }
  const deadline = Date.now() + 12000;
  // Bounded batches reuse the shared rate limiter; interactive requests can interleave.
  for (let i = 0; i < Math.min(24, region.municipalities.length); i++) {
    if (client.cooldownUntil > Date.now() || Date.now() >= deadline) break;
    const town = region.municipalities[(cursor + i) % region.municipalities.length];
    await president({ state: uf, municipality: town.code });
    cursors.set(uf, (cursor + i + 1) % region.municipalities.length);
  }
  for (const town of region.municipalities) {
    const entry = client.peek<ElectionSnapshot>(
      resultUrl(config.value, {
        type: 'municipality',
        state: uf,
        code: town.code,
        name: town.name,
      }),
    );
    if (entry?.value) remember(municipalMetric(entry.value, !!entry.issue));
  }
  const results = knownMunicipalities().filter((m) => m.uf === uf);
  return {
    uf,
    total: region.municipalities.length,
    available: results.length,
    results,
    nextPollMs: Math.max(POLL_MS, 10000),
    progressive: true,
  };
}
