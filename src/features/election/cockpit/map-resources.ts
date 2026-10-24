import { candidateTone, type MapTheme } from './map-theme';
export type MapMode = 'states' | 'municipalities' | 'margin' | 'counted' | 'candidate';
export type Shape = {
  uf: string;
  code?: string | null;
  name: string;
  path: string;
  label: number[];
  bounds?: number[];
  ibge?: string;
  zones?: string[];
};
const geometryCache = new Map<string, Promise<Shape[]>>();
export function municipalGeometry(uf: string) {
  let promise = geometryCache.get(uf);
  if (!promise) {
    promise = fetch(`/maps/${uf}.json`, { signal: AbortSignal.timeout(15000) }).then(async (r) => {
      if (!r.ok) throw new Error('Malha indisponível');
      return (await r.json()).shapes as Shape[];
    });
    geometryCache.set(uf, promise);
    promise.catch(() => geometryCache.delete(uf));
  }
  return promise;
}
type Metric = {
  counted: number | null;
  candidates: { number: string; name: string; percentage: number; votes: number; color: string }[];
  validVotes?: number | null;
  updatedAt?: string | null;
};
export function mapFill(
  mode: MapMode,
  metric: Metric | undefined,
  candidate: string,
  theme: MapTheme,
) {
  if (!metric) return theme.empty;
  if (mode === 'counted') {
    const v = metric.counted;
    if (v === null) return theme.empty;
    return theme.counted[Math.min(4, Math.floor(v / 25))];
  }
  const list = metric.candidates;
  const lead = list[0];
  if (mode === 'candidate') {
    const c = list.find((c) => c.number === candidate);
    if (!c) return theme.empty;
    const opacity = 0.12 + Math.max(0, Math.min(100, c.percentage)) * 0.0088;
    return mix(candidateTone(c.color, theme), opacity, theme.canvas);
  }
  if (!lead || !lead.votes || lead.votes === list[1]?.votes) return theme.tie;
  if (mode === 'margin')
    return mix(
      candidateTone(lead.color, theme),
      0.2 + Math.min(0.8, (Math.max(0, lead.percentage - (list[1]?.percentage ?? 0)) / 50) * 0.8),
      theme.canvas,
    );
  return candidateTone(lead.color, theme);
}
function mix(hex: string, fraction: number, canvas: string) {
  const base = [1, 3, 5].map((i) => parseInt(canvas.slice(i, i + 2), 16));
  const values = [1, 3, 5].map((i, k) =>
    Math.round(base[k] + (parseInt(hex.slice(i, i + 2), 16) - base[k]) * fraction),
  );
  return `rgb(${values.join(',')})`;
}
