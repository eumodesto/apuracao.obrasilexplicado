import { client, CLIENT_POLL_MS, STALE_MS } from '@/lib/tse/service';
import { CONFIG_URL, discoverElection, normalizeGeography } from '@/lib/tse/config';
import { geographyUrl, resultUrl } from '@/lib/tse/urls';
import { normalizeResult } from '@/lib/tse/normalizers';
import { validVoteAnalysis } from '@/lib/tse/analysis';
import type { TseClient } from '@/lib/tse/client';
import type { ElectionResponse, Geography, Scope } from '@/lib/tse/types';
export const emptyBootResult: ElectionResponse = {
  status: 'unavailable',
  snapshot: null,
  stale: false,
  issue: null,
  checkedAt: null,
  nextPollMs: CLIENT_POLL_MS,
  staleAfterMs: STALE_MS,
};
/** Read existing validated cache only. Existing APIs handle upstream refresh. */
export async function readBootCache(
  reader: Pick<TseClient, 'restore'> = client,
): Promise<{ initial: ElectionResponse; regions: Geography[] }> {
  const config = await reader.restore(CONFIG_URL, discoverElection);
  if (!config?.value) return { initial: emptyBootResult, regions: [] };
  const scope: Scope = { type: 'country', code: 'br', state: 'br', name: 'Brasil' },
    url = resultUrl(config.value, scope);
  const [geo, result] = await Promise.all([
    reader.restore(geographyUrl(config.value), normalizeGeography),
    reader.restore(url, (raw) => normalizeResult(raw, config.value!, scope, url)),
  ]);
  const snapshot = result?.value ?? null,
    age = snapshot
      ? Date.now() - Date.parse(snapshot.progress.totaledAt ?? snapshot.progress.generatedAt)
      : 0;
  return {
    regions: geo?.value ?? [],
    initial: {
      ...emptyBootResult,
      snapshot,
      status: snapshot?.status ?? 'unavailable',
      analysis: validVoteAnalysis(snapshot),
      checkedAt: result?.checkedAt ? new Date(result.checkedAt).toISOString() : null,
      attemptedAt: result?.attemptedAt ? new Date(result.attemptedAt).toISOString() : null,
      stale: !!result?.issue || (snapshot?.status === 'counting' && age > STALE_MS),
      issue: result?.issue ? 'Os dados oficiais estão temporariamente indisponíveis.' : null,
    },
  };
}
