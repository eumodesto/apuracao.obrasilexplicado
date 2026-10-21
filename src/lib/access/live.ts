import { CONFIG_URL, discoverElection } from '@/lib/tse/config';
import { normalizeResult } from '@/lib/tse/normalizers';
import { client } from '@/lib/tse/service';
import { resultUrl } from '@/lib/tse/urls';
import type { Scope } from '@/lib/tse/types';

const CHECK_MS = 10_000;
const country: Scope = { type: 'country', code: 'br', state: 'br', name: 'Brasil' };
let memo: { at: number; value: Promise<boolean> } | null = null;

/**
 * Whether the national count has started (results published), read from the existing cache only.
 * Free time is not spent while the panel can only say "waiting for the TSE".
 */
export function countStarted(now = Date.now()): Promise<boolean> {
  // Testing switch: spend free time before the TSE publishes anything (journey tests).
  if (process.env.FREE_TIME_BEFORE_COUNT === 'true') return Promise.resolve(true);
  if (memo && now - memo.at < CHECK_MS) return memo.value;
  const value = (async () => {
    try {
      const config = await client.restore(CONFIG_URL, discoverElection);
      if (!config?.value) return false;
      const url = resultUrl(config.value, country);
      const result = await client.restore(url, (raw) =>
        normalizeResult(raw, config.value!, country, url),
      );
      const snapshot = result?.value;
      return !!snapshot && (snapshot.status !== 'waiting' || snapshot.progress.countedSections > 0);
    } catch {
      // When in doubt, count: never hand out unlimited free time because of a cache error.
      return true;
    }
  })();
  memo = { at: now, value };
  return value;
}
