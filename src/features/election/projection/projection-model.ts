import { roundBand, type BandSide } from '@/features/landing/round-band-model';
import type { ElectionSnapshot } from '@/lib/tse/types';

export type ProjectionSide = {
  id: string;
  name: string;
  color: string;
  /** Observed share of valid votes so far. */
  currentPercentage: number;
  /**
   * Estimated final share if the current distribution of valid votes holds for the
   * remaining sections (linear extrapolation → same % as today).
   */
  projectedPercentage: number;
  votes: number;
};

export type ProjectionModel =
  | { state: 'unavailable'; reason: string }
  | {
      state: 'estimate';
      first: ProjectionSide;
      second: ProjectionSide;
      counted: number;
      remainingPercent: number;
      remainingSections: number;
      gapPoints: number;
    }
  | {
      state: 'final';
      first: ProjectionSide;
      second: ProjectionSide;
      counted: number;
      gapPoints: number;
    };

const side = (band: BandSide): ProjectionSide => ({
  id: band.id,
  name: band.name,
  color: band.color,
  currentPercentage: band.percentage,
  projectedPercentage: band.percentage,
  votes: band.votes,
});

/**
 * Simple linear projection for the two finalists: if the share of valid votes stays the
 * same through the remaining sections, the final % equals the current %. Waiting / zero
 * counted → unavailable; finished / 100% → official result (no “estimate” framing).
 */
export function projectionModel(snapshot: ElectionSnapshot | null): ProjectionModel {
  if (!snapshot || snapshot.status === 'waiting')
    return { state: 'unavailable', reason: 'Aguardando dados suficientes' };
  const band = roundBand(snapshot);
  if (!band) return { state: 'unavailable', reason: 'Aguardando dados suficientes' };
  const counted = snapshot.progress.percentageCounted;
  if (counted <= 0 && (snapshot.progress.validVotes ?? 0) <= 0)
    return { state: 'unavailable', reason: 'Aguardando dados suficientes' };

  const first = side(band.headline.first);
  const second = side(band.headline.second);
  const gapPoints = first.projectedPercentage - second.projectedPercentage;
  const done = snapshot.status === 'finished' || counted >= 100 || snapshot.progress.finished;

  if (done)
    return {
      state: 'final',
      first,
      second,
      counted,
      gapPoints,
    };

  const remainingSections = Math.max(0, band.remainingSections);
  const remainingPercent = Math.max(0, 100 - counted);
  return {
    state: 'estimate',
    first,
    second,
    counted,
    remainingPercent,
    remainingSections,
    gapPoints,
  };
}
