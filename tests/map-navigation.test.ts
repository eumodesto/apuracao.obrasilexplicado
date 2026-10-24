import { describe, it, expect } from 'vitest';
import {
  SpatialIndex,
  zoomView,
  interpolateView,
  collisionFreeLabels,
  NATIONAL_VIEW,
  fitBounds,
} from '../src/features/election/cockpit/map-navigation';
import { normalizeZone, zoneUrl } from '../src/lib/tse/zones';
import { discoverElection } from '../src/lib/tse/config';
import { readFileSync } from 'node:fs';
const fixture = (p: string) => JSON.parse(readFileSync(`tests/fixtures/${p}.json`, 'utf8'));
describe('continuous cartographic navigation', () => {
  it('keeps the cursor world point fixed while zooming, and preserves aspect ratio', () => {
    const v = zoomView(NATIONAL_VIEW, 0.5, [0.8, 0.2]);
    expect(v[0] + v[2] * 0.8).toBeCloseTo(NATIONAL_VIEW[0] + NATIONAL_VIEW[2] * 0.8);
    expect(v[1] + v[3] * 0.2).toBeCloseTo(NATIONAL_VIEW[1] + NATIONAL_VIEW[3] * 0.2);
    expect(v[2] / v[3]).toBeCloseTo(NATIONAL_VIEW[2] / NATIONAL_VIEW[3]);
  });
  it('indexes crossing polygons without duplicating them and rejects distant areas', () => {
    const a = { uf: 'pb', name: 'A', path: '', label: [10, 10], bounds: [1, 1, 25, 25] },
      b = { uf: 'pe', name: 'B', path: '', label: [51, 51], bounds: [50, 50, 55, 55] };
    const index = new SpatialIndex([a, b], 12);
    expect(index.query([0, 0, 30, 30])).toEqual([a]);
    expect(index.query([49, 49, 56, 56])).toEqual([b]);
    expect(index.query([40, 40, 45, 45])).toEqual([]);
  });
  it('prefers the selected city and suppresses colliding labels', () => {
    const labels = [
      { key: 'small', x: 50, y: 50, width: 90, height: 16, priority: 1 },
      { key: 'capital', x: 51, y: 51, width: 80, height: 16, priority: 100 },
      { key: 'distant', x: 200, y: 200, width: 70, height: 16, priority: 2 },
    ];
    expect(collisionFreeLabels(labels).map((l) => l.key)).toEqual(['capital', 'distant']);
  });
  it('fits a municipality with margin and interpolates without discontinuity', () => {
    const target = fitBounds([100, 200, 110, 220]);
    expect(target[0]).toBeLessThan(100);
    expect(target[1]).toBeLessThan(200);
    expect(interpolateView(NATIONAL_VIEW, target, 0)).toEqual(NATIONAL_VIEW);
    interpolateView(NATIONAL_VIEW, target, 1).forEach((v, i) => expect(v).toBeCloseTo(target[i]));
    const middle = interpolateView(NATIONAL_VIEW, target, 0.5);
    expect(middle[2]).toBeGreaterThan(target[2]);
    expect(middle[2]).toBeLessThan(NATIONAL_VIEW[2]);
  });
});
describe('official EA20 zone results', () => {
  const config = discoverElection(fixture('ele-c')),
    raw = fixture('president-zone-0070'),
    url = zoneUrl(config, 'pb', '20516', '0070');
  it('reads a real zone without applying municipal or national votes', () => {
    const zone = normalizeZone(raw, config, 'pb', '20516', '0070', url);
    expect(zone.number).toBe('0070');
    expect(zone.progress?.countedSections).toBe(323);
    expect(zone.progress?.totalSections).toBe(323);
    expect(zone.candidates[0].votes).toBe(43571);
    expect(zone.candidates[1].votes).toBe(42121);
    expect(zone.sourceUrl).toContain('pb20516-z0070-c0001-e006257-u.json');
  });
  it('rejects another zone, another election, undisclosed results and arbitrary URL components', () => {
    for (const patch of [{ cdabr: '0064' }, { ele: '6259' }, { dv: 'n' }, { tpabr: 'mu' }])
      expect(() =>
        normalizeZone({ ...raw, ...patch }, config, 'pb', '20516', '0070', url),
      ).toThrow();
    expect(() => zoneUrl(config, 'pb', '../20516', '0070')).toThrow();
    expect(() => zoneUrl(config, 'zz', '20516', '0070')).toThrow();
  });
});
