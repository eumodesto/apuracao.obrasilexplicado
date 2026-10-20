import states from '../../../data/geography/ufs.json';
import { validVoteAnalysis, type ValidVoteAnalysis } from './analysis';
import { candidateColor } from './candidate-colors';
import { CONFIG_URL, discoverElection, roundConfig } from './config';
import { normalizeResult } from './normalizers';
import { client } from './service';
import type { ElectionSnapshot, Scope } from './types';
import { resultUrl } from './urls';

/** Final results change rarely: check the TSE at most every 30 minutes. */
const FINAL_INTERVAL_MS = 30 * 60_000;

export type RoundPlace = {
  uf: string;
  name: string;
  /** Leading candidate's color and share of valid votes, for the map. */
  leader: { number: string; name: string; color: string; percentage: number } | null;
  snapshot: ElectionSnapshot | null;
};

export type RoundResult = {
  available: boolean;
  national: ElectionSnapshot | null;
  analysis: ValidVoteAnalysis | null;
  places: RoundPlace[];
  exterior: RoundPlace | null;
  checkedAt: string | null;
};

const country: Scope = { type: 'country', code: 'br', state: 'br', name: 'Brasil' };

function leaderOf(snapshot: ElectionSnapshot | null): RoundPlace['leader'] {
  const top = snapshot?.candidates[0];
  if (!snapshot || !top || !snapshot.progress.validVotes || top.votes === 0) return null;
  return {
    number: top.number,
    name: top.ballotName,
    color: candidateColor(top),
    percentage: Math.round((top.votes / snapshot.progress.validVotes) * 10_000) / 100,
  };
}

/** 1st-round configuration derived from the active one, or null before it is published. */
async function firstRoundConfig() {
  const active = await client.read(CONFIG_URL, discoverElection, 3_600_000);
  return active.value && roundConfig(active.value, '1');
}

/** Only the national 1st-round result (used to validate candidate photos). */
export async function firstRoundNational() {
  const config = await firstRoundConfig();
  if (!config) return null;
  const url = resultUrl(config, country);
  return (
    await client.read(url, (raw) => normalizeResult(raw, config, country, url), FINAL_INTERVAL_MS)
  ).value;
}

/**
 * Official 1st-round results (Brazil, 27 states and abroad), read from the TSE with the same
 * client, cache and limits as the live panel. The 1st-round URLs carry their own election code,
 * so they never mix with the 2nd round's.
 */
export async function firstRound(): Promise<RoundResult> {
  const empty: RoundResult = {
    available: false,
    national: null,
    analysis: null,
    places: [],
    exterior: null,
    checkedAt: null,
  };
  const config = await firstRoundConfig();
  if (!config) return empty;
  const read = (scope: Scope) => {
    const url = resultUrl(config, scope);
    return client.read(url, (raw) => normalizeResult(raw, config, scope, url), FINAL_INTERVAL_MS);
  };
  const scopes: Scope[] = states.map((state) => {
    const uf = state.sigla.toLowerCase();
    return { type: 'state', code: uf, state: uf, name: state.nome };
  });
  const exteriorScope: Scope = { type: 'exterior', code: 'zz', state: 'zz', name: 'Exterior' };
  // Sequential: the client spaces requests to the TSE anyway, and this keeps one in flight.
  const national = await read(country);
  const places: RoundPlace[] = [];
  for (const scope of scopes) {
    const result = await read(scope);
    places.push({
      uf: scope.code,
      name: scope.name,
      leader: leaderOf(result.value),
      snapshot: result.value,
    });
  }
  const abroad = await read(exteriorScope);
  return {
    available: !!national.value,
    national: national.value,
    analysis: validVoteAnalysis(national.value),
    places,
    exterior: {
      uf: 'zz',
      name: 'Exterior',
      leader: leaderOf(abroad.value),
      snapshot: abroad.value,
    },
    checkedAt: national.checkedAt ? new Date(national.checkedAt).toISOString() : null,
  };
}
