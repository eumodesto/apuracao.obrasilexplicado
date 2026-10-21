import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RaceCards } from '../src/features/election/race/race-cards';
import { raceModel } from '../src/features/election/race/race-model';
import { aggregateRegion } from '../src/lib/tse/region-rows';
import { discoverElection } from '../src/lib/tse/config';
import { normalizeResult } from '../src/lib/tse/normalizers';
import { resultUrl } from '../src/lib/tse/urls';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const config = discoverElection(fixture('ele-c'), undefined);
const br = { type: 'country' as const, code: 'br', state: 'br', name: 'Brasil' };

/** The official national file with the given votes per number (others get 1.000). */
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

describe('left column (race cards)', () => {
  const snapshot = result(
    { '13': 53_879_538, '22': 56_104_503 },
    { '13': '2º turno', '22': '2º turno' },
  );

  it('summarizes the gap, the other candidates and the rest from the official file', () => {
    const model = raceModel(snapshot, 3)!;
    expect(model.finalists.map((f) => f.number).sort()).toEqual(['13', '22']);
    expect(model.gap.votes).toBe(56_104_503 - 53_879_538);
    expect(model.others).toHaveLength(Math.min(3, model.total - 2));
    expect(model.rest.count).toBe(Math.max(0, model.total - 5));
    expect(model.validVotes).toBe(snapshot.progress.validVotes);
  });

  it('draws one line per finalist from the observed moments, ending at the latest value', () => {
    const model = raceModel(snapshot)!;
    const [first, second] = model.finalists;
    const html = renderToStaticMarkup(
      createElement(RaceCards, {
        model,
        tag: '2º turno · 40% apurado',
        fact: { label: 'Seções apuradas', value: '1 de 2' },
        series: [
          {
            side: first,
            points: [
              { x: 10, y: 51 },
              { x: 25, y: 50.4 },
              { x: 40, y: 49.8 },
            ],
          },
          {
            side: second,
            points: [
              { x: 10, y: 49 },
              { x: 25, y: 49.6 },
              { x: 40, y: 50.2 },
            ],
          },
        ],
        emptyChart: 'vazio',
      }),
    );
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).toContain(`stroke="${first.color}"`);
    // Under 50% counted, the axis ends at the last counted share instead of 100%.
    expect(html).toContain('<small>40%</small>');
    // The last point sits at the right edge of the plot.
    expect(html).toMatch(/left:100%/);
    expect(html).not.toContain('vazio');
  });

  it('shows the waiting text until there are two observations', () => {
    const model = raceModel(snapshot)!;
    const html = renderToStaticMarkup(
      createElement(RaceCards, {
        model,
        tag: '2º turno · 0% apurado',
        fact: { label: 'Seções apuradas', value: '0 de 2' },
        series: model.finalists.map((side) => ({ side, points: [{ x: 1, y: 50 }] })),
        emptyChart: 'A curva aparece após duas observações.',
      }),
    );
    expect(html).not.toContain('<polyline');
    expect(html).toContain('A curva aparece após duas observações.');
  });
});

describe('region rows', () => {
  it('computes the leader over the summed valid votes and the counted share', () => {
    const snapshot = result({ '13': 70_000, '22': 30_000 });
    const row = aggregateRegion('Exterior', [snapshot]);
    expect(row.leader?.number).toBe('13');
    expect(row.counted).toBeCloseTo(
      (snapshot.progress.countedSections / snapshot.progress.totalSections) * 100,
    );
  });

  it('has no leader and no progress while any state is missing', () => {
    expect(aggregateRegion('Norte', [result({}), null])).toMatchObject({
      counted: null,
    });
    expect(aggregateRegion('Norte', [null])).toEqual({
      name: 'Norte',
      counted: null,
      leader: null,
    });
  });
});
