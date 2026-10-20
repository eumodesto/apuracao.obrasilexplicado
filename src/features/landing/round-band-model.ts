import { validVoteAnalysis } from '@/lib/tse/analysis';
import type { ElectionSnapshot } from '@/lib/tse/types';
import { partyByCode } from '@/lib/profile/parties';

/** Band colors: the left side in red, the right side in blue. */
export const SIDE_COLORS = { left: '#ee2e3a', right: '#4062e2' } as const;

/** Accents the TSE ballot names leave out, for display only. */
const ACCENTS: Record<string, string> = {
  flavio: 'Flávio',
  joao: 'João',
  jose: 'José',
  antonio: 'Antônio',
  marcio: 'Márcio',
  fabio: 'Fábio',
  cassio: 'Cássio',
  vinicius: 'Vinícius',
  sergio: 'Sérgio',
};

/** "FLAVIO BOLSONARO" → "Flávio Bolsonaro". */
export function displayName(name: string) {
  return name
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      ['da', 'de', 'do', 'das', 'dos', 'e'].includes(word)
        ? word
        : (ACCENTS[word] ?? word[0].toLocaleUpperCase('pt-BR') + word.slice(1)),
    )
    .join(' ');
}

export type BandSide = {
  id: string;
  name: string;
  party: string;
  number: string;
  percentage: number;
  votes: number;
  color: string;
};

export type BandModel = {
  left: BandSide;
  right: BandSide;
  /** Names in the order of the headline (most voted first), with their side colors. */
  headline: { first: BandSide; second: BandSide; text: string };
  counted: number;
  remainingSections: number;
  /** Official totalization time, once the round is decided. */
  definedAt: string | null;
};

/**
 * The two finalists of a round (or the two most voted while counting), placed by side: the
 * party of the left (13) on the left, the right (22) on the right, as in the sign-up cards.
 */
export function roundBand(snapshot: ElectionSnapshot | null): BandModel | null {
  const analysis = validVoteAnalysis(snapshot);
  if (!snapshot || !analysis || analysis.candidates.length < 2) return null;
  const status = new Map(snapshot.candidates.map((c) => [c.id, c.status ?? '']));
  const party = new Map(snapshot.candidates.map((c) => [c.id, c.party]));
  const finalists = analysis.candidates.filter((c) => /turno/i.test(status.get(c.id) ?? ''));
  const pair = (finalists.length === 2 ? finalists : analysis.candidates.slice(0, 2)).map((c) => ({
    id: c.id,
    name: displayName(c.name),
    party: party.get(c.id) ?? '',
    number: c.number,
    percentage: c.percentage,
    votes: c.votes,
    color: '',
  }));
  const sideOf = (side: BandSide) =>
    partyByCode(side.party.trim().toUpperCase())?.side ??
    (side.number === '13' ? 'esquerda' : side.number === '22' ? 'direita' : null);
  let [left, right] = pair;
  if (sideOf(left) === 'direita' || sideOf(right) === 'esquerda') [left, right] = [right, left];
  left = { ...left, color: SIDE_COLORS.left };
  right = { ...right, color: SIDE_COLORS.right };
  const [first, second] = left.votes >= right.votes ? [left, right] : [right, left];
  const elected = snapshot.candidates.find((c) => c.elected);
  const decided = finalists.length === 2 || !!elected;
  const text =
    finalists.length === 2
      ? 'vão ao 2º turno'
      : elected
        ? 'eleito'
        : snapshot.status === 'finished'
          ? 'apuração encerrada'
          : 'lideram a apuração';
  return {
    left,
    right,
    headline: { first, second, text },
    counted: snapshot.progress.percentageCounted,
    remainingSections: Math.max(
      0,
      snapshot.progress.totalSections - snapshot.progress.countedSections,
    ),
    definedAt: decided ? (snapshot.progress.totaledAt ?? snapshot.progress.generatedAt) : null,
  };
}
