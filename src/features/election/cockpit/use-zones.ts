'use client';
import { useEffect, useState } from 'react';
import type { ZoneResponse, ZoneResult } from '@/lib/tse/zone-types';
export function useZones(uf: string, town: string, numbers: string[], historical: boolean) {
  const [value, setValue] = useState<{
    key: string;
    data: ZoneResponse;
    unavailable: boolean;
  } | null>(null);
  const key = uf + town;
  useEffect(() => {
    if (!uf || !town || historical || !numbers.length) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    let etag = '';
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/election/president/zones?state=${uf}&municipality=${town}`,
          {
            headers: etag ? { 'If-None-Match': etag } : {},
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]),
          },
        );
        if (response.status !== 304) {
          if (!response.ok) throw Error();
          const data: ZoneResponse = await response.json();
          if (!stopped) {
            setValue({ key, data, unavailable: false });
            etag = response.headers.get('etag') ?? '';
          }
        }
      } catch {
        if (!stopped) setValue((p) => (p?.key === key ? { ...p, unavailable: true } : p));
      } finally {
        if (!stopped) timer = setTimeout(poll, 15000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [uf, town, numbers.length, key, historical]);
  const zones: ZoneResult[] =
    !historical && value?.key === key
      ? value.data.zones
      : numbers.map((number) => ({
          number,
          progress: null,
          candidates: [],
          version: null,
          sourceUrl: '',
          checkedAt: null,
          stale: true,
          issue: historical ? 'Zona não registrada neste momento' : 'Resultado ainda não recebido',
        }));
  return { zones, unavailable: value?.key === key && value.unavailable, historical };
}
