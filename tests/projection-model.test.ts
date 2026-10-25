import { describe, expect, it } from 'vitest';
import type { ElectionSnapshot } from '@/lib/tse/types';
import { projectionModel } from '@/features/election/projection/projection-model';

function snapshot(over: {
  status?: ElectionSnapshot['status'];
  progress?: Partial<ElectionSnapshot['progress']>;
} = {}): ElectionSnapshot {
  return {
    version: '1',
    status: over.status ?? 'counting',
    scope: { type: 'country', code: 'br', state: 'br', name: 'Brasil' },
    progress: {
      totalSections: 1000,
      countedSections: 400,
      percentageCounted: 40,
      eligibleVoters: 100,
      turnout: 80,
      abstentions: 20,
      validVotes: 70,
      blankVotes: 5,
      nullVotes: 5,
      generatedAt: '2026-10-26T20:00:00Z',
      totaledAt: null,
      finished: false,
      ...over.progress,
    },
    candidates: [
      {
        id: '1',
        number: '22',
        name: 'CANDIDATO A',
        ballotName: 'CANDIDATO A',
        party: 'PL',
        coalition: null,
        federation: null,
        votes: 40,
        percentage: 57.14,
        status: '2º turno',
        elected: false,
        destination: 'Válido',
        imageUrl: '',
        order: 1,
      },
      {
        id: '2',
        number: '13',
        name: 'CANDIDATO B',
        ballotName: 'CANDIDATO B',
        party: 'PT',
        coalition: null,
        federation: null,
        votes: 30,
        percentage: 42.86,
        status: '2º turno',
        elected: false,
        destination: 'Válido',
        imageUrl: '',
        order: 2,
      },
    ],
    source: 'TSE',
    sourceUrl: '',
    turn: '2',
  };
}

describe('projectionModel', () => {
  it('is unavailable while waiting', () => {
    const model = projectionModel(
      snapshot({ status: 'waiting', progress: { percentageCounted: 0, validVotes: 0 } }),
    );
    expect(model.state).toBe('unavailable');
  });

  it('projects current shares while counting', () => {
    const model = projectionModel(snapshot());
    expect(model.state).toBe('estimate');
    if (model.state !== 'estimate') return;
    expect(model.first.projectedPercentage).toBe(model.first.currentPercentage);
    expect(model.remainingPercent).toBe(60);
    expect(model.remainingSections).toBe(600);
  });

  it('marks finished counts as final', () => {
    const model = projectionModel(
      snapshot({
        status: 'finished',
        progress: { percentageCounted: 100, finished: true, countedSections: 1000 },
      }),
    );
    expect(model.state).toBe('final');
  });
});
