import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import states from '../data/geography/ufs.json';
import { CONFIG_URL, discoverElection } from '../src/lib/tse/config';
import { normalizeResult } from '../src/lib/tse/normalizers';
import { simulatedTransport, stateProgress } from '../src/lib/tse/simulation';
import { resultUrl } from '../src/lib/tse/urls';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const MINUTE = 60_000;
const TOTAL = 10 * MINUTE;
const runtime = globalThis as typeof globalThis & { tseSimulationStart?: number };

/** The TSE config with the 1st round (6257) and the 2nd round (6258) of the presidential race. */
function config() {
  const base = fixture('ele-c');
  const president = [{ cd: 'br', cp: [{ cd: '1' }] }];
  return {
    f: 'o',
    arq: base.arq,
    pl: [
      {
        cd: '3220',
        c: 'ele2026',
        dt: '04/10/2026',
        e: [{ cd: '6257', t: '1', tp: '8', abr: president }],
      },
      {
        cd: '3221',
        c: 'ele2026',
        dt: '25/10/2026',
        e: [{ cd: '6258', t: '2', tp: '8', abr: president }],
      },
    ],
  };
}

/** Paraíba's official file, as the 1st round (with votes) or the empty 2nd-round template. */
function paraiba(round: 1 | 2) {
  const file = fixture('president-pb');
  file.ele = round === 1 ? '6257' : '6258';
  file.t = String(round);
  for (const group of file.carg[0].agr)
    for (const party of group.par) {
      party.cand = party.cand.filter(
        (c: { n: string }) => round === 1 || ['13', '22'].includes(c.n),
      );
      for (const c of party.cand) {
        c.vap = String(round === 1 ? ({ '13': 600_000, '22': 400_000 }[c.n as '13'] ?? 50_000) : 0);
        c.st = round === 1 && ['13', '22'].includes(c.n) ? '2º turno' : '';
      }
    }
  file.carg[0].agr = file.carg[0].agr.filter((g: { par: { cand: unknown[] }[] }) =>
    g.par.some((p) => p.cand.length),
  );
  file.v = { ...file.v, vb: round === 1 ? '20000' : '0', tvn: round === 1 ? '30000' : '0' };
  file.e = { ...file.e, c: round === 1 ? '1100000' : '0', a: round === 1 ? '300000' : '0' };
  return file;
}

async function simulatedParaiba(elapsed: number) {
  const second = discoverElection(config(), undefined);
  const scope = { type: 'state' as const, code: 'pb', state: 'pb', name: 'Paraíba' };
  const url = resultUrl(second, scope);
  const firstUrl = url.replace('/6258/', '/6257/').replace('-e006258-', '-e006257-');
  const files: Record<string, unknown> = {
    [CONFIG_URL]: config(),
    [url]: paraiba(2),
    [firstUrl]: paraiba(1),
  };
  const real = (async (input: RequestInfo | URL) => {
    const body = files[String(input)];
    return body ? Response.json(body) : new Response(null, { status: 404 });
  }) as typeof fetch;
  runtime.tseSimulationStart = Date.now() - elapsed;
  const response = await simulatedTransport(real)(url);
  return normalizeResult(await response.json(), second, scope, url);
}

afterEach(() => {
  delete runtime.tseSimulationStart;
});

describe('2nd-round simulation', () => {
  it('starts every state at zero and finishes all of them by the end', () => {
    for (const s of states) {
      const uf = s.sigla.toLowerCase();
      expect(stateProgress(uf, 0, TOTAL)).toBe(0);
      expect(stateProgress(uf, TOTAL, TOTAL)).toBe(1);
    }
    expect(stateProgress('zz', TOTAL, TOTAL)).toBe(1);
  });

  it('only moves forward, and the South counts ahead of the Northeast', () => {
    let previous = 0;
    for (let t = 0; t <= TOTAL; t += 15_000) {
      const share = stateProgress('ba', t, TOTAL);
      expect(share).toBeGreaterThanOrEqual(previous);
      previous = share;
    }
    expect(stateProgress('rs', 0.3 * TOTAL, TOTAL)).toBeGreaterThan(
      stateProgress('ba', 0.3 * TOTAL, TOTAL),
    );
  });

  it('builds an official 2nd-round file with only the finalists, read as round 2', async () => {
    const halfway = await simulatedParaiba(0.5 * TOTAL);
    expect(halfway.turn).toBe('2');
    expect(halfway.status).toBe('counting');
    expect(halfway.candidates.map((c) => c.number).sort()).toEqual(['13', '22']);
    const share = halfway.progress.countedSections / halfway.progress.totalSections;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    const lula = halfway.candidates.find((c) => c.number === '13')!;
    // Votes follow the same share as the sections (which are rounded to whole sections).
    expect(Math.abs(lula.votes / 600_000 - share)).toBeLessThan(1 / halfway.progress.totalSections);
    expect(halfway.progress.validVotes).toBe(halfway.candidates.reduce((s, c) => s + c.votes, 0));
  });

  it('ends with the 1st-round votes of both finalists and the state finished', async () => {
    const end = await simulatedParaiba(TOTAL);
    expect(end.status).toBe('finished');
    expect(end.progress.countedSections).toBe(end.progress.totalSections);
    expect(Object.fromEntries(end.candidates.map((c) => [c.number, c.votes]))).toEqual({
      '13': 600_000,
      '22': 400_000,
    });
    // A state file does not decide the presidential race.
    expect(end.candidates.some((c) => c.elected)).toBe(false);
  });
});
