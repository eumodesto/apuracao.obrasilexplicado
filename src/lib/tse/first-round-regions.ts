import states from '../../../data/geography/ufs.json';
import { firstRound } from './first-round';
import { aggregateRegion, REGION_NAMES } from './region-rows';

export type { RegionLeader, RegionRowModel } from './region-rows';

const regionOf = new Map(states.map((state) => [state.sigla.toLowerCase(), state.regiao.nome]));

/** Official 1st-round result by region and abroad, or null before the TSE publishes it. */
export async function firstRoundRegions() {
  const result = await firstRound();
  if (!result.available) return null;
  return {
    regions: REGION_NAMES.map((name) =>
      aggregateRegion(
        name,
        result.places.filter((place) => regionOf.get(place.uf) === name).map((p) => p.snapshot),
      ),
    ),
    exterior: aggregateRegion('Exterior', [result.exterior?.snapshot ?? null]),
  };
}
