import { candidateColor } from './candidate-colors';
import type { ElectionSnapshot } from './types';

export type RegionLeader = {
  id: string;
  number: string;
  party: string;
  name: string;
  color: string;
  /** Share of valid votes (0–100). */
  percentage: number;
};

export type RegionRowModel = {
  name: string;
  /** Sections counted (0–100), or null when unknown. */
  counted: number | null;
  leader: RegionLeader | null;
};

export const REGION_NAMES = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

/** Sums the states' votes, so each region's leader is computed over its own valid votes. */
export function aggregateRegion(
  name: string,
  snapshots: (ElectionSnapshot | null)[],
): RegionRowModel {
  const available = snapshots.filter((s): s is ElectionSnapshot => !!s);
  let valid = 0,
    sections = 0,
    counted = 0;
  const totals = new Map<string, { votes: number; candidate: ElectionSnapshot['candidates'][0] }>();
  for (const snapshot of available) {
    valid += snapshot.progress.validVotes ?? 0;
    sections += snapshot.progress.totalSections;
    counted += snapshot.progress.countedSections;
    for (const candidate of snapshot.candidates) {
      const entry = totals.get(candidate.number);
      if (entry) entry.votes += candidate.votes;
      else totals.set(candidate.number, { votes: candidate.votes, candidate });
    }
  }
  const top = [...totals.values()].sort((a, b) => b.votes - a.votes)[0];
  return {
    name,
    counted: available.length === snapshots.length && sections ? (counted / sections) * 100 : null,
    leader:
      top && valid && top.votes
        ? {
            id: top.candidate.id,
            number: top.candidate.number,
            party: top.candidate.party,
            name: top.candidate.ballotName,
            color: candidateColor(top.candidate),
            percentage: (top.votes / valid) * 100,
          }
        : null,
  };
}
