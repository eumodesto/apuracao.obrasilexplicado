import { describe, it, expect } from 'vitest';
import { tooltipPosition } from '../src/features/election/cockpit/map-tooltip';
import { mapFill } from '../src/features/election/cockpit/map-resources';
import type { MapTheme } from '../src/features/election/cockpit/map-theme';
const theme: MapTheme = {
  neighborDim: 'rgba(0,0,0,.06)',
  empty: '#242421',
  tie: '#4d4d47',
  border: '#10100f',
  stateBorder: '#363630',
  highlight: 'rgba(255,255,255,.12)',
  outline: '#deddd5',
  text: '#eeede8',
  canvas: '#0b0b0a',
  candidate1: '#176399',
  candidate2: '#c6293e',
  counted: ['#292923', '#494940', '#707063', '#9c9c88', '#d3d3b9'],
};
describe('cartographic exploration', () => {
  it.each([
    [1, 1],
    [818, 1],
    [1, 813],
    [818, 813],
  ])('tooltip remains inside canvas near %i,%i', (x, y) => {
    const p = tooltipPosition({ x, y }, [819, 814], [270, 230]);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.left + 270).toBeLessThanOrEqual(811);
    expect(p.top + 230).toBeLessThanOrEqual(806);
  });
  it('candidate intensity reflects the selected vote share even when another candidate leads', () => {
    const metric = {
      counted: 100,
      candidates: [
        { number: '13', name: 'Lula', votes: 70, percentage: 70, color: '#E31837' },
        { number: '22', name: 'Flávio', votes: 30, percentage: 30, color: '#005CAA' },
      ],
    };
    const color = mapFill('candidate', metric, '22', theme);
    expect(color).toMatch(/^rgb/);
    expect(color).not.toBe(mapFill('candidate', metric, '13', theme));
    const channels = color.match(/\d+/g)!.map(Number);
    expect(channels[2]).toBeGreaterThan(channels[0]);
  });
  it('missing municipal data remains neutral in all modes', () => {
    for (const mode of ['states', 'municipalities', 'margin', 'counted', 'candidate'] as const)
      expect(mapFill(mode, undefined, '22', theme)).toBe(theme.empty);
  });
  it('zero selected votes and tied results are still valid candidate heatmaps', () => {
    const metric = {
      counted: 100,
      candidates: [
        { number: '13', name: 'Lula', votes: 50, percentage: 50, color: '#E31837' },
        { number: '22', name: 'Flávio', votes: 50, percentage: 50, color: '#005CAA' },
      ],
    };
    expect(mapFill('candidate', metric, '22', theme)).not.toBe(theme.tie);
    expect(mapFill('margin', metric, '22', theme)).toBe(theme.tie);
  });
});
