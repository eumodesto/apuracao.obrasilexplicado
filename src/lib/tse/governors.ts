import states from '../../../data/geography/ufs.json';
import { normalizeResult } from './normalizers';
import { catalog, client, POLL_MS, STALE_MS } from './service';
import { resultUrl } from './urls';
import type { ElectionConfig, ElectionSnapshot, Scope } from './types';

export type GovernorRace = {
  uf: string;
  name: string;
  snapshot: ElectionSnapshot | null;
  stale: boolean;
};

const names = new Map(states.map((s) => [s.sigla.toLowerCase(), s.nome]));

/**
 * Governor races of the active round, one official state file each, read with the same client,
 * cache and limits as the presidential result. In the 2nd round the TSE lists only the states
 * with a runoff.
 */
export async function governorRaces(): Promise<{ races: GovernorRace[]; turn: string | null }> {
  const { config } = await catalog();
  const governor = config.value?.governor;
  if (!config.value || !governor) return { races: [], turn: null };
  const election: ElectionConfig = { ...config.value, ...governor, office: '0003' };
  const races = await Promise.all(
    governor.states.map(async (uf) => {
      const scope: Scope = { type: 'state', code: uf, state: uf, name: names.get(uf) ?? uf };
      const url = resultUrl(election, scope, '0003');
      const result = await client.read(
        url,
        (raw) => normalizeResult(raw, election, scope, url, 3),
        POLL_MS,
      );
      const snapshot = result.value;
      const age = snapshot
        ? Date.now() - Date.parse(snapshot.progress.totaledAt ?? snapshot.progress.generatedAt)
        : Infinity;
      return {
        uf,
        name: scope.name,
        snapshot,
        stale: !!result.issue || (snapshot?.status === 'counting' && age > STALE_MS),
      };
    }),
  );
  return { races, turn: governor.turn };
}

/** A governor candidate of the active round (for the photo route). */
export async function governorCandidate(id: string) {
  const { races } = await governorRaces();
  for (const race of races) {
    const candidate = race.snapshot?.candidates.find((c) => c.id === id);
    if (candidate) return candidate;
  }
  return null;
}
