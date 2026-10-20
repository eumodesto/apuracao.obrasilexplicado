import type { CandidateResult, ElectionProgress } from './types';
export type ZoneResult={
  number:string;version:string|null;progress:ElectionProgress|null;candidates:CandidateResult[];
  sourceUrl:string;checkedAt:string|null;stale:boolean;issue:string|null;
};
export type ZoneResponse={uf:string;municipality:string;zones:ZoneResult[];nextPollMs:number;geometryAvailable:false};
