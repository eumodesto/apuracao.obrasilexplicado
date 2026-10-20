export type ElectionConfig = {
  cycle: string;
  election: string;
  contest: string;
  office: string;
  turn: string;
  /** Election day as published by the TSE (dd/mm/yyyy). */
  date: string;
  directories: Record<string, string>;
  /** Every round of this presidential election published so far, the chosen one included. */
  rounds?: { contest: string; election: string; turn: string; date: string }[];
};
export type Geography = {
  code: string;
  name: string;
  municipalities: { code: string; name: string; ibge?: string; zones?: string[] }[];
};
export type Scope = {
  type: 'country' | 'state' | 'municipality' | 'exterior';
  code: string;
  state: string;
  name: string;
};
export type CandidateResult = {
  id: string;
  number: string;
  name: string;
  ballotName: string;
  party: string;
  coalition: string | null;
  federation: string | null;
  votes: number;
  percentage: number;
  status: string | null;
  elected: boolean;
  destination: string | null;
  imageUrl: string;
  order: number;
};
export type ElectionProgress = {
  totalSections: number;
  countedSections: number;
  percentageCounted: number;
  eligibleVoters: number | null;
  turnout: number | null;
  abstentions: number | null;
  validVotes: number | null;
  blankVotes: number | null;
  nullVotes: number | null;
  generatedAt: string;
  totaledAt: string | null;
  finished: boolean;
};
export type ElectionSnapshot = {
  version: string;
  status: 'waiting' | 'counting' | 'finished';
  scope: Scope;
  progress: ElectionProgress;
  candidates: CandidateResult[];
  source: 'TSE';
  sourceUrl: string;
  /** Round of the election ('1' or '2'). */
  turn?: string;
};
export type ElectionResponse = {
  analysis?: import('./analysis').ValidVoteAnalysis;
  attemptedAt?: string | null;
  status: 'waiting' | 'counting' | 'finished' | 'unavailable';
  snapshot: ElectionSnapshot | null;
  stale: boolean;
  issue: string | null;
  checkedAt: string | null;
  nextPollMs: number;
  staleAfterMs?: number;
};
