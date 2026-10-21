import { firstRoundRegions } from '@/lib/tse/first-round-regions';
import { RegionBoard } from './region-board';

/** "Por região" with the official 1st-round result, shown until the 2nd-round count opens. */
export async function FirstRoundRegions() {
  const data = await firstRoundRegions().catch(() => null);
  return data ? (
    <RegionBoard regions={data.regions} exterior={data.exterior} tag="1º turno" />
  ) : null;
}
