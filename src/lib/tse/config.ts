import { configSchema, geographySchema } from './schemas';
import type { ElectionConfig, Geography } from './types';
export const CONFIG_URL = 'https://resultados.tse.jus.br/oficial/comum/config/ele-c.json';
/** Presidential office code in the TSE files. */
const PRESIDENT = 1;
/**
 * Picks the 2026 federal election that includes the presidential race nationwide. With more than
 * one published (1st and 2nd round), the latest round wins; `TSE_TURN` pins a specific round.
 */
export function discoverElection(input: unknown, turn = process.env.TSE_TURN): ElectionConfig {
  const data = configSchema.parse(input);
  const options = data.pl
    .filter((p) => p.c === 'ele2026')
    .flatMap((contest) =>
      contest.e
        .filter((e) =>
          e.abr.some((a) => a.cd === 'br' && a.cp.some((c) => Number(c.cd) === PRESIDENT)),
        )
        .map((election) => ({ contest, election })),
    )
    .sort((a, b) => Number(b.election.t) - Number(a.election.t));
  const chosen = options.find(({ election }) => !turn || election.t === turn);
  if (!chosen) throw new Error('Election configuration not published or changed');
  return {
    cycle: chosen.contest.c,
    contest: chosen.contest.cd,
    election: chosen.election.cd,
    office: '0001',
    turn: chosen.election.t,
    date: chosen.contest.dt,
    directories: Object.fromEntries(data.arq.map((a) => [a.tp, a.dir])),
    rounds: options.map(({ contest, election }) => ({
      contest: contest.cd,
      election: election.cd,
      turn: election.t,
      date: contest.dt,
    })),
  };
}

/** The configuration of another round of the same election (e.g. the 1st round during the 2nd). */
export function roundConfig(config: ElectionConfig, turn: string): ElectionConfig | null {
  const round = config.rounds?.find((item) => item.turn === turn);
  return round ? { ...config, ...round } : null;
}
export function normalizeGeography(input: unknown): Geography[] {
  return geographySchema.parse(input).abr.map((a) => ({
    code: a.cd,
    name: a.ds,
    municipalities: a.mu.map((m) => ({
      code: m.cd,
      name: m.nm,
      ...(m.cdi ? { ibge: m.cdi } : {}),
      ...(m.z ? { zones: m.z } : {}),
    })),
  }));
}
