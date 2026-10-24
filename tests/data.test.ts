import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { discoverElection, normalizeGeography } from '../src/lib/tse/config';
import { normalizeResult } from '../src/lib/tse/normalizers';
import { resultUrl, geographyUrl } from '../src/lib/tse/urls';
import { querySchema, trackingSchema } from '../src/lib/tse/schemas';
import { resolveScope } from '../src/lib/tse/service';
import type { Scope } from '../src/lib/tse/types';
const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const config = discoverElection(fixture('ele-c'), undefined);
const regions = normalizeGeography(fixture('municipalities'));
const br: Scope = { type: 'country', code: 'br', state: 'br', name: 'Brasil' };
const normalize = (raw: unknown, scope = br) =>
  normalizeResult(raw, config, scope, resultUrl(config, scope));
describe('Official 2026 contracts', () => {
  it('discovers the federal election and presidential office', () => {
    expect(config).toMatchObject({
      election: '6257',
      contest: '3220',
      office: '0001',
      cycle: 'ele2026',
    });
    expect(geographyUrl(config)).toContain('/6257/config/mun-e006257-cm.json');
  });
  it('follows the 2nd round once the TSE publishes it, unless TSE_TURN pins a round', () => {
    const published = fixture('ele-c');
    published.pl.push({
      cd: '3221',
      c: 'ele2026',
      dt: '25/10/2026',
      e: [
        {
          cd: '6258',
          t: '2',
          abr: [
            { cd: 'br', cp: [{ cd: '1' }] },
            { cd: 'sp', cp: [{ cd: '3' }] },
          ],
        },
        { cd: '6260', t: '2', abr: [{ cd: 'sp', cp: [{ cd: '3' }] }] },
      ],
    });
    expect(discoverElection(published, undefined)).toMatchObject({
      election: '6258',
      contest: '3221',
      turn: '2',
      date: '25/10/2026',
    });
    expect(discoverElection(published, '1')).toMatchObject({ election: '6257', turn: '1' });
    expect(() => discoverElection(fixture('ele-c'), '2')).toThrow();
  });
  it('rejects a missing election, wrong phase and other offices', () => {
    expect(() => discoverElection({ f: 'o', arq: [], pl: [] })).toThrow();
    const raw = fixture('president-br');
    raw.f = 's';
    expect(() => normalize(raw)).toThrow();
    raw.f = 'o';
    raw.carg[0].cd = '3';
    expect(() => normalize(raw)).toThrow();
  });
  it('preserves real zero votes and all twelve candidates', () => {
    const data = normalize(fixture('president-br'));
    expect(data.status).toBe('waiting');
    expect(data.progress.percentageCounted).toBe(0);
    expect(data.candidates).toHaveLength(12);
    expect(data.candidates.every((c) => c.votes === 0 && !c.elected)).toBe(true);
    expect(data.progress.totalSections).toBe(499248);
    expect(data.progress.eligibleVoters).toBe(158745502);
  });
  it('sorts votes descending and ties by official sequence', () => {
    const raw = fixture('president-br');
    raw.and = 'p';
    raw.s.st = '50';
    raw.s.pst = '0,01';
    raw.carg[0].agr[0].par[0].cand[0].vap = '120';
    raw.carg[0].agr[0].par[0].cand[0].pvap = '60,00';
    const data = normalize(raw);
    expect(data.status).toBe('counting');
    expect(data.candidates[0].votes).toBe(120);
    expect(data.candidates[0].percentage).toBe(60);
    expect(data.candidates[1].order).toBe(1);
  });
  it('does not infer completion at 100 percent or winner from e=s', () => {
    const raw = fixture('president-br');
    raw.s.st = raw.s.ts;
    raw.s.pst = '100,00';
    raw.and = 'p';
    const c = raw.carg[0].agr[0].par[0].cand[0];
    c.e = 's';
    c.st = '2º turno';
    let data = normalize(raw);
    expect(data.status).toBe('counting');
    expect(data.candidates.find((x) => x.number === c.n)?.elected).toBe(false);
    raw.and = 'f';
    c.st = 'Eleito';
    data = normalize(raw);
    expect(data.status).toBe('finished');
    expect(data.candidates.find((x) => x.number === c.n)?.elected).toBe(true);
  });
  it.each([
    ['president-pb', { state: 'PB' }],
    ['president-municipality', { state: 'PB', municipality: '20516' }],
    ['president-zz', { scope: 'exterior' }],
    ['president-locality', { scope: 'exterior', municipality: '29254' }],
  ])('validates real %s', (name, query) => {
    const scope = resolveScope(querySchema.parse(query), regions);
    expect(normalize(fixture(name as string), scope).scope.code).toBe(scope.code);
  });
  it('rejects cross-scope data, malformed numbers and hidden disclosure', () => {
    const raw = fixture('president-br');
    raw.cdabr = 'pb';
    expect(() => normalize(raw)).toThrow();
    raw.cdabr = 'br';
    raw.dv = 'n';
    expect(() => normalize(raw)).toThrow();
    raw.dv = 's';
    raw.s.st = '';
    expect(() => normalize(raw)).toThrow();
  });
  it('uses official exterior locations and municipality codes', () => {
    expect(regions.find((r) => r.code === 'zz')?.municipalities[0]).toMatchObject({
      code: '29254',
      name: 'ABIDJÃ',
    });
    const scope = resolveScope(querySchema.parse({ state: 'PB', municipality: '20516' }), regions);
    expect(resultUrl(config, scope)).toContain('/pb/pb20516-c0001-e006257-u.json');
    expect(() =>
      resolveScope(querySchema.parse({ state: 'PB', municipality: '01120' }), regions),
    ).toThrow();
  });
  it.each([
    { url: 'https://evil.test' },
    { state: '../' },
    { municipality: '20516' },
    { scope: 'exterior', state: 'PB' },
    { state: 'PB', municipality: '1234' },
  ])('rejects invalid query %j', (query) => {
    expect(querySchema.safeParse(query).success).toBe(false);
  });
  it('rejects untrusted directory templates', () => {
    expect(() =>
      resultUrl(
        { ...config, directories: { ...config.directories, u: 'https://evil.test/<uf>' } },
        br,
      ),
    ).toThrow();
  });
  it('validates EA14 and EA15 current files', () => {
    expect(trackingSchema.parse(fixture('tracking-br')).abr.length).toBeGreaterThan(20);
    expect(trackingSchema.parse(fixture('tracking-pb')).abr.length).toBeGreaterThan(200);
  });
});
