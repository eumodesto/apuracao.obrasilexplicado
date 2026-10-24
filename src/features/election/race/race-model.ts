import { validVoteAnalysis } from '@/lib/tse/analysis';
import type { ElectionSnapshot } from '@/lib/tse/types';
import { displayName, roundBand, type BandSide } from '@/features/landing/round-band-model';

export type RaceCandidate = {
  id: string;
  name: string;
  /** "Avante 70" */
  party: string;
  color: string;
  percentage: number;
  votes?: number;
};

export type RaceModel = {
  counted: number;
  /** Lead of the first over the second, in points of valid votes and in votes. */
  gap: { points: number; votes: number };
  /** The two finalists, colored by side as in the band at the top. */
  finalists: [BandSide, BandSide];
  others: RaceCandidate[];
  rest: { count: number; percentage: number };
  total: number;
  validVotes: number;
  turnout: number | null;
  blankAndNull: number | null;
};

/** Party names that read as words get title case; acronyms stay as they are. */
const PARTY_WORDS: Record<string, string> = {
  AVANTE: 'Avante',
  MISSÃO: 'Missão',
  NOVO: 'Novo',
  DEMOCRATA: 'Democrata',
};
const partyLabel = (party: string) => PARTY_WORDS[party.trim().toUpperCase()] ?? party;

/**
 * Left-column summary of a finished (or counting) round, from the national result. With
 * `shown = 0` it covers only the two finalists, as the 2nd round will.
 */
export function raceModel(snapshot: ElectionSnapshot | null, shown = 3): RaceModel | null {
  const analysis = validVoteAnalysis(snapshot);
  const band = roundBand(snapshot);
  if (!snapshot || !analysis || !band || analysis.candidates.length < 2) return null;
  const [first, second] = analysis.candidates;
  const party = new Map(snapshot.candidates.map((c) => [c.id, c.party]));
  const finalists = new Set([band.left.id, band.right.id]);
  const others = analysis.candidates.filter((c) => !finalists.has(c.id));
  const rest = shown > 0 ? others.slice(shown) : [];
  const { progress } = snapshot;
  return {
    counted: progress.percentageCounted,
    gap: { points: first.percentage - second.percentage, votes: first.votes - second.votes },
    finalists: [band.headline.first, band.headline.second],
    others: others.slice(0, shown).map((c) => ({
      id: c.id,
      name: displayName(c.name),
      party: `${partyLabel(party.get(c.id) ?? '')} ${c.number}`.trim(),
      color: c.color,
      percentage: c.percentage,
    })),
    rest: { count: rest.length, percentage: rest.reduce((sum, c) => sum + c.percentage, 0) },
    total: analysis.candidates.length,
    validVotes: analysis.validVotes,
    // Over the voters of the sections counted so far, not the whole electorate.
    turnout:
      progress.turnout != null && progress.abstentions != null
        ? (progress.turnout / (progress.turnout + progress.abstentions || 1)) * 100
        : progress.turnout != null && progress.eligibleVoters
          ? (progress.turnout / progress.eligibleVoters) * 100
          : null,
    blankAndNull:
      progress.turnout && progress.blankVotes != null && progress.nullVotes != null
        ? ((progress.blankVotes + progress.nullVotes) / progress.turnout) * 100
        : null,
  };
}
