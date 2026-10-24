'use client';
import { useEffect, useState } from 'react';
import type { ElectionResponse } from '@/lib/tse/types';
import { candidateColor } from '@/lib/tse/candidate-colors';
import type { MunicipalMetric } from '@/lib/tse/municipal-map';
const cache = new Map<string, { at: number; metric: MunicipalMetric }>();
export function useHoverMetric(uf: string, code: string, enabled: boolean) {
  const key = uf + code,
    [value, setValue] = useState<{ key: string; metric: MunicipalMetric } | null>(null);
  useEffect(() => {
    if (!enabled || !code) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const saved = cache.get(key);
      if (saved && Date.now() - saved.at < 15000) {
        setValue({ key, metric: saved.metric });
        return;
      }
      try {
        const response = await fetch(`/api/election/president?state=${uf}&municipality=${code}`, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]),
        });
        if (!response.ok) return;
        const data: ElectionResponse = await response.json(),
          s = data.snapshot;
        if (!s || s.scope.type !== 'municipality' || s.scope.state !== uf || s.scope.code !== code)
          return;
        const metric: MunicipalMetric = {
          uf,
          code,
          name: s.scope.name,
          version: s.version,
          updatedAt: s.progress.totaledAt ?? s.progress.generatedAt,
          counted: s.progress.percentageCounted,
          validVotes: s.progress.validVotes,
          stale: data.stale,
          candidates: s.candidates.map((c) => ({
            id: c.id,
            number: c.number,
            name: c.ballotName,
            votes: c.votes,
            percentage: c.percentage,
            color: candidateColor(c),
          })),
        };
        if (!abort.signal.aborted) {
          cache.set(key, { at: Date.now(), metric });
          setValue({ key, metric });
        }
      } catch {
        /* Keep the geographic hover; unavailable data never replaces known votes. */
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [uf, code, key, enabled]);
  return enabled && value?.key === key ? value.metric : null;
}
