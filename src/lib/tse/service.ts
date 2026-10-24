import path from 'node:path';
import { validVoteAnalysis } from './analysis';
import { history } from './history';
import { FileBackedCache } from './cache';
import { TseClient } from './client';
import { CONFIG_URL, discoverElection, normalizeGeography } from './config';
import { normalizeResult } from './normalizers';
import { querySchema } from './schemas';
import { simulatedTransport, simulationEnabled, tseCacheDir } from './simulation';
import { geographyUrl, resultUrl } from './urls';
import type { ElectionResponse, Geography, Scope } from './types';
const runtime = globalThis as typeof globalThis & { tseClient?: TseClient };
export const client = (runtime.tseClient ??= new TseClient(
  new FileBackedCache(path.resolve(/* turbopackIgnore: true */ tseCacheDir())),
  simulationEnabled() ? simulatedTransport(fetch) : fetch,
));
client.serveStale = true;
function setting(value: string | undefined, fallback: number, min: number) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
}
export const POLL_MS = setting(process.env.TSE_POLL_INTERVAL_MS, 3000, 3000);
/** How often browsers ask this server for results (X-Poll-After); the TSE itself is read every POLL_MS. */
export const CLIENT_POLL_MS = setting(process.env.CLIENT_POLL_INTERVAL_MS, 10000, 3000);
export const STALE_MS = setting(process.env.TSE_STALE_AFTER_MS, 120000, 30000);
export async function catalog() {
  const config = await client.read(CONFIG_URL, discoverElection, 3_600_000);
  if (!config.value) return { config, geography: null };
  const geography = await client.read(geographyUrl(config.value), normalizeGeography, 3_600_000);
  return { config, geography };
}
export class QueryError extends Error {}
export function resolveScope(
  query: ReturnType<typeof querySchema.parse>,
  geography: Geography[],
): Scope {
  const state = query.scope === 'exterior' ? 'zz' : (query.state ?? 'br');
  if (state === 'br') {
    if (query.municipality) throw new QueryError('Município requer UF.');
    return { type: 'country', code: 'br', state: 'br', name: 'Brasil' };
  }
  const region = geography.find((g) => g.code === state);
  if (!region) throw new QueryError('Abrangência não encontrada no catálogo oficial.');
  if (query.municipality) {
    const town = region.municipalities.find((m) => m.code === query.municipality);
    if (!town) throw new QueryError('Município não pertence à abrangência selecionada.');
    return {
      type: 'municipality',
      code: town.code,
      state,
      name: `${town.name} / ${state.toUpperCase()}`,
    };
  }
  return { type: state === 'zz' ? 'exterior' : 'state', code: state, state, name: region.name };
}
export async function president(params: Record<string, string>): Promise<ElectionResponse> {
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) throw new QueryError('Filtros inválidos. Use os códigos oficiais do TSE.');
  const { config, geography } = await catalog();
  if (!config.value || !geography?.value)
    return {
      status: 'unavailable',
      snapshot: null,
      stale: true,
      issue: 'Os dados oficiais estão temporariamente indisponíveis.',
      checkedAt: null,
      nextPollMs: 30000,
      staleAfterMs: STALE_MS,
    };
  const scope = resolveScope(parsed.data, geography.value);
  const url = resultUrl(config.value, scope);
  const result = await client.read(
    url,
    (raw) => normalizeResult(raw, config.value!, scope, url),
    POLL_MS,
  );
  const snapshot = result.value;
  const checkedAt = result.checkedAt ? new Date(result.checkedAt).toISOString() : null;
  if (snapshot && scope.type === 'country') await history.record(snapshot, checkedAt);
  const age = snapshot
    ? Date.now() - Date.parse(snapshot.progress.totaledAt ?? snapshot.progress.generatedAt)
    : Infinity;
  const stale =
    !!result.issue ||
    !!config.issue ||
    !!geography.issue ||
    (snapshot?.status === 'counting' && age > STALE_MS);
  const issue =
    result.issue || config.issue || geography.issue
      ? 'Os dados oficiais estão temporariamente indisponíveis.'
      : null;
  return {
    analysis: validVoteAnalysis(snapshot),
    attemptedAt: result.attemptedAt ? new Date(result.attemptedAt).toISOString() : null,
    status: snapshot?.status ?? (result.issue === 'HTTP 404' ? 'waiting' : 'unavailable'),
    snapshot,
    stale,
    issue,
    checkedAt,
    nextPollMs: Math.max(CLIENT_POLL_MS, Math.min(60000, result.nextAttempt - Date.now())),
    staleAfterMs: STALE_MS,
  };
}
