import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayName, roundBand, SIDE_COLORS } from '../src/features/landing/round-band-model';
import { discoverElection } from '../src/lib/tse/config';
import { normalizeResult } from '../src/lib/tse/normalizers';
import { resultUrl } from '../src/lib/tse/urls';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const config = discoverElection(fixture('ele-c'), undefined);
const br = { type: 'country' as const, code: 'br', state: 'br', name: 'Brasil' };

/** The official national file with the given votes per number and statuses. */
function result(votes: Record<string, number>, status: Record<string, string> = {}) {
  const raw = fixture('president-br');
  const candidates = raw.carg[0].agr.flatMap((a: { par: { cand: unknown[] }[] }) =>
    a.par.flatMap((p) => p.cand),
  ) as { n: string; vap: string; dvt?: string; st: string }[];
  for (const c of candidates) {
    c.vap = String(votes[c.n] ?? 1000);
    c.dvt = 'Válido';
    c.st = status[c.n] ?? '';
  }
  raw.v.vv = String(candidates.reduce((sum, c) => sum + Number(c.vap), 0));
  raw.s.st = raw.s.ts;
  return normalizeResult(raw, config, br, resultUrl(config, br));
}

describe('1st-round band', () => {
  it('puts 13 on the left and 22 on the right, with the most voted first in the headline', () => {
    const band = roundBand(
      result({ '13': 53_879_538, '22': 56_104_503 }, { '13': '2º turno', '22': '2º turno' }),
    )!;
    expect(band.left).toMatchObject({ number: '13', name: 'Lula', color: SIDE_COLORS.left });
    expect(band.right).toMatchObject({
      number: '22',
      name: 'Flávio Bolsonaro',
      color: SIDE_COLORS.right,
    });
    expect(band.headline.first.number).toBe('22');
    expect(band.headline.text).toBe('vão ao 2º turno');
    expect(band.left.percentage + band.right.percentage).toBeLessThan(100);
    expect(band.remainingSections).toBe(0);
    expect(band.definedAt).not.toBeNull();
  });

  it('uses the two most voted while there are no finalists yet', () => {
    const band = roundBand(result({ '13': 900, '22': 800, '30': 5000, '21': 4000 }))!;
    expect([band.left.number, band.right.number].sort()).toEqual(['21', '30']);
    expect(band.headline.text).not.toBe('vão ao 2º turno');
    expect(band.definedAt).toBeNull();
  });

  it('shows the 2nd-round finalists at zero before the first votes, not the 1st round', () => {
    const base = result({ '13': 1, '22': 1 });
    const band = roundBand({
      ...base,
      turn: '2',
      candidates: base.candidates
        .filter((c) => c.number === '13' || c.number === '22')
        .map((c) => ({ ...c, votes: 0, percentage: 0, destination: null, status: '' })),
      progress: { ...base.progress, validVotes: 0, percentageCounted: 0, countedSections: 0 },
    })!;
    expect(band.left).toMatchObject({ number: '13', votes: 0, percentage: 0 });
    expect(band.right).toMatchObject({ number: '22', votes: 0, percentage: 0 });
    expect(band.counted).toBe(0);
    expect(band.headline.text).toBe('disputam o 2º turno');
    expect(band.definedAt).toBeNull();
  });

  it('writes ballot names with accents for display', () => {
    expect(displayName('FLAVIO BOLSONARO')).toBe('Flávio Bolsonaro');
    expect(displayName('JOAO DA SILVA')).toBe('João da Silva');
  });
});
