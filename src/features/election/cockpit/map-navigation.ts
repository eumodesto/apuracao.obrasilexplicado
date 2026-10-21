export type View = [number, number, number, number];
export type Bounds = [number, number, number, number];
export type MapShape = {
  uf: string;
  code?: string | null;
  name: string;
  path: string;
  label: number[];
  bounds?: number[];
  ibge?: string;
  zones?: string[];
};
export const NATIONAL_VIEW: View = [10, -18, 720, 724];
export const MUNICIPAL_ZOOM = 1.8;
export const AUTO_MUNICIPAL_ZOOM = 2.8;
export const LOCAL_ZOOM = 9;
export function shapeBounds(shape: MapShape): Bounds {
  if (shape.bounds) return shape.bounds as Bounds;
  const values = (shape.path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = values.filter((_, i) => i % 2 === 0),
    ys = values.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
export function intersects(a: number[], b: number[]) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
export function viewBounds(v: View): Bounds {
  return [v[0], v[1], v[0] + v[2], v[1] + v[3]];
}
export function fitBounds(bounds: number[], padding = 0.14): View {
  const w = Math.max(0.05, bounds[2] - bounds[0]),
    h = Math.max(0.05, bounds[3] - bounds[1]);
  return [
    bounds[0] - w * padding,
    bounds[1] - h * padding,
    w * (1 + 2 * padding),
    h * (1 + 2 * padding),
  ];
}
export function zoomView(v: View, factor: number, anchor: [number, number] = [0.5, 0.5]): View {
  const w = Math.max(0.06, Math.min(1440, v[2] * factor)),
    h = (v[3] * w) / v[2];
  return [v[0] + (v[2] - w) * anchor[0], v[1] + (v[3] - h) * anchor[1], w, h];
}
export function interpolateView(a: View, b: View, t: number): View {
  const ease = t * t * (3 - 2 * t),
    w = a[2] * Math.pow(b[2] / a[2], ease),
    h = a[3] * Math.pow(b[3] / a[3], ease);
  const cx = (a[0] + a[2] / 2) * (1 - ease) + (b[0] + b[2] / 2) * ease,
    cy = (a[1] + a[3] / 2) * (1 - ease) + (b[1] + b[3] / 2) * ease;
  return [cx - w / 2, cy - h / 2, w, h];
}
/** A fixed grid avoids scanning thousands of polygons during pointer movement. */
export class SpatialIndex<T extends MapShape> {
  private cells = new Map<string, Set<T>>();
  readonly bounds = new Map<T, Bounds>();
  constructor(
    items: T[],
    private cellSize = 12,
  ) {
    for (const item of items) {
      const b = shapeBounds(item);
      this.bounds.set(item, b);
      for (let x = Math.floor(b[0] / cellSize); x <= Math.floor(b[2] / cellSize); x++)
        for (let y = Math.floor(b[1] / cellSize); y <= Math.floor(b[3] / cellSize); y++) {
          const key = x + ':' + y;
          let cell = this.cells.get(key);
          if (!cell) {
            cell = new Set();
            this.cells.set(key, cell);
          }
          cell.add(item);
        }
    }
  }
  query(b: Bounds) {
    const found = new Set<T>();
    for (let x = Math.floor(b[0] / this.cellSize); x <= Math.floor(b[2] / this.cellSize); x++)
      for (let y = Math.floor(b[1] / this.cellSize); y <= Math.floor(b[3] / this.cellSize); y++)
        for (const item of this.cells.get(x + ':' + y) ?? [])
          if (intersects(this.bounds.get(item)!, b)) found.add(item);
    return [...found];
  }
}
export type LabelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  key: string;
  priority: number;
};
export function collisionFreeLabels(labels: LabelBox[], limit = 70) {
  const accepted: LabelBox[] = [];
  for (const label of [...labels].sort(
    (a, b) => b.priority - a.priority || a.key.localeCompare(b.key),
  )) {
    if (accepted.length >= limit) break;
    if (
      accepted.some(
        (a) =>
          Math.abs(a.x - label.x) < (a.width + label.width) / 2 + 8 &&
          Math.abs(a.y - label.y) < (a.height + label.height) / 2 + 6,
      )
    )
      continue;
    accepted.push(label);
  }
  return accepted;
}
