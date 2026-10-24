import { PARTY_COLORS } from '@/lib/tse/candidate-colors';
/** Canvas presentation reads the same semantic tokens as the surrounding UI. */
export function readMapTheme() {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string) => styles.getPropertyValue(name).trim();
  return {
    neighborDim: value('--map-neighbor-dim'),
    empty: value('--map-empty'),
    tie: value('--map-tie'),
    border: value('--map-border'),
    stateBorder: value('--map-border-state'),
    highlight: value('--map-highlight'),
    outline: value('--map-outline'),
    text: value('--text-primary'),
    canvas: value('--bg-canvas'),
    candidate1: value('--candidate-1'),
    candidate2: value('--candidate-2'),
    counted: [1, 2, 3, 4, 5].map((i) => value(`--map-counted-${i}`)),
  };
}
export type MapTheme = ReturnType<typeof readMapTheme>;
export function candidateTone(color: string, theme: MapTheme) {
  return color.toUpperCase() === PARTY_COLORS.PL
    ? theme.candidate1
    : color.toUpperCase() === PARTY_COLORS.PT
      ? theme.candidate2
      : color;
}
