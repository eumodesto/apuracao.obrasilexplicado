import type { CandidateResult, ElectionSnapshot } from './types';
import { candidateColor } from './candidate-colors';
import type {
  ElectionMapSnapshot,
  MapCandidate,
  MapLegendEntry,
  RegionalResult,
  StateInput,
  StateMapResult,
} from './map-types';
export class CandidateColors {
  private colors = new Map<string, string>();
  assign(candidates: Pick<CandidateResult, 'id' | 'party'>[]) {
    for (const candidate of candidates) this.colors.set(candidate.id, candidateColor(candidate));
  }
  get(id: string) {
    const color = this.colors.get(id);
    if (!color) throw new Error('Unregistered candidate color');
    return color;
  }
}
const timestamp = (s: ElectionSnapshot) => s.progress.totaledAt ?? s.progress.generatedAt;
function contender(candidate: CandidateResult, colors: CandidateColors): MapCandidate {
  return {
    id: candidate.id,
    number: candidate.number,
    name: candidate.ballotName,
    votes: candidate.votes,
    percentage: candidate.percentage,
    color: colors.get(candidate.id),
  };
}
export function normalizeState(input: StateInput, colors: CandidateColors): StateMapResult {
  const { snapshot: s } = input;
  const base = {
    candidates: s?.candidates.map(c => contender(c, colors)) ?? [],
    validVotes: s?.progress.validVotes ?? null,
    eligibleVoters: s?.progress.eligibleVoters ?? null,
    uf: input.uf,
    name: input.name,
    region: input.region,
    status: (s?.status ?? 'unavailable') as StateMapResult['status'],
    countedPercentage: s?.progress.percentageCounted ?? null,
    updatedAt: s ? timestamp(s) : null,
    version: s?.version ?? null,
    stale: input.stale,
    issue: input.issue,
  };
  const ranked = [...(s?.candidates ?? [])].sort((a, b) => b.votes - a.votes || a.order - b.order);
  if (!s)
    return {
      ...base,
      outcome: 'missing',
      leader: null,
      runnerUp: null,
      tied: [],
      marginVotes: null,
      marginPercentagePoints: null,
    };
  if (s.status === 'waiting' || !ranked.length || ranked[0].votes === 0)
    return {
      ...base,
      outcome: 'waiting',
      leader: null,
      runnerUp: null,
      tied: [],
      marginVotes: null,
      marginPercentagePoints: null,
    };
  const tied = ranked.filter((c) => c.votes === ranked[0].votes);
  if (tied.length > 1)
    return {
      ...base,
      outcome: 'tie',
      leader: null,
      runnerUp: null,
      tied: tied.map((c) => contender(c, colors)),
      marginVotes: 0,
      marginPercentagePoints: 0,
    };
  return {
    ...base,
    outcome: 'leader',
    leader: contender(ranked[0], colors),
    runnerUp: ranked[1] ? contender(ranked[1], colors) : null,
    tied: [],
    marginVotes: ranked[1] ? ranked[0].votes - ranked[1].votes : null,
    marginPercentagePoints: ranked[1] ? ranked[0].percentage - ranked[1].percentage : null,
  };
}
export function aggregateRegion(
  name: string,
  inputs: StateInput[],
  colors: CandidateColors,
): RegionalResult {
  const available = inputs.filter(
    (i): i is StateInput & { snapshot: ElectionSnapshot } => !!i.snapshot,
  );
  const totals = new Map<string, MapLegendEntry & { votes: number; percentage: number | null }>();
  let reliable = available.length === inputs.length,
    validVotes = 0,
    totalSections = 0,
    countedSections = 0;
  for (const input of available) {
    const s = input.snapshot;
    totalSections += s.progress.totalSections;
    countedSections += s.progress.countedSections;
    if (s.progress.validVotes === null) reliable = false;
    else validVotes += s.progress.validVotes;
    let candidateValid = 0;
    for (const c of s.candidates) {
      const valid = c.destination === 'Válido';
      // Before counting, absent destination is harmless at zero. Positive unknown votes are not silently treated as valid.
      if (c.votes > 0 && !c.destination) reliable = false;
      const votes = valid ? c.votes : 0;
      candidateValid += votes;
      const previous = totals.get(c.id);
      totals.set(c.id, {
        id: c.id,
        number: c.number,
        name: c.ballotName,
        color: colors.get(c.id),
        stateCount: 0,
        votes: (previous?.votes ?? 0) + votes,
        percentage: null,
      });
    }
    if (s.progress.validVotes !== null && candidateValid !== s.progress.validVotes)
      reliable = false;
  }
  const candidates = [...totals.values()]
    .sort((a, b) => b.votes - a.votes || Number(a.number) - Number(b.number))
    .map((c) => ({
      ...c,
      percentage: reliable && validVotes > 0 ? (c.votes / validVotes) * 100 : null,
    }));
  return {
    name,
    eligibleVoters:
      available.length === inputs.length &&
      available.every((i) => i.snapshot.progress.eligibleVoters !== null)
        ? available.reduce((sum, i) => sum + i.snapshot.progress.eligibleVoters!, 0)
        : null,
    availableStates: available.length,
    totalStates: inputs.length,
    reliable,
    validVotes: reliable ? validVotes : null,
    countedPercentage:
      available.length === inputs.length && totalSections > 0
        ? (countedSections / totalSections) * 100
        : null,
    stale: inputs.some((i) => i.stale),
    candidates,
    issue: reliable
      ? null
      : available.length < inputs.length
        ? 'Aguardando todas as UFs da região.'
        : 'Aguardando consistência dos votos válidos oficiais.',
  };
}
export function buildMapSnapshot(
  inputs: StateInput[],
  national: ElectionSnapshot | null,
  colors: CandidateColors,
  upstreamIssue: string | null = null,
): ElectionMapSnapshot {
  colors.assign([
    ...(national?.candidates ?? []),
    ...inputs.flatMap((i) => i.snapshot?.candidates ?? []),
  ]);
  const states = inputs.map((i) => normalizeState(i, colors));
  const known = new Map<string, MapLegendEntry>();
  for (const c of [
    ...(national?.candidates ?? []),
    ...inputs.flatMap((i) => i.snapshot?.candidates ?? []),
  ])
    if (!known.has(c.id))
      known.set(c.id, {
        id: c.id,
        number: c.number,
        name: c.ballotName,
        color: colors.get(c.id),
        stateCount: 0,
      });
  for (const state of states) if (state.leader) known.get(state.leader.id)!.stateCount++;
  const legend = [...known.values()].sort(
    (a, b) => b.stateCount - a.stateCount || Number(a.number) - Number(b.number),
  );
  const dates = states
    .flatMap((s) => (s.updatedAt ? [s.updatedAt] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const regions = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'].map((name) => {
    const region = aggregateRegion(
      name,
      inputs.filter((i) => i.region === name),
      colors,
    );
    return {
      ...region,
      electorateWeight:
        region.eligibleVoters != null && national?.progress.eligibleVoters
          ? (region.eligibleVoters / national.progress.eligibleVoters) * 100
          : null,
    };
  });
  return {
    status: national?.status ?? 'unavailable',
    updatedAt: dates.at(-1) ?? null,
    oldestUpdatedAt: dates[0] ?? null,
    nationalUpdatedAt: national ? timestamp(national) : null,
    nationalProgress: national?.progress.percentageCounted ?? null,
    states,
    legend,
    regions,
    missingStates: states.filter((s) => s.outcome === 'missing').length,
    waitingStates: states.filter((s) => s.outcome === 'waiting').length,
    tiedStates: states.filter((s) => s.outcome === 'tie').length,
    stale: !!upstreamIssue || states.some((s) => s.stale),
    issue: upstreamIssue,
  };
}
