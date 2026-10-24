import { firstRoundNational } from '@/lib/tse/first-round';
import { roundBand } from './round-band-model';
import { RoundBand } from './round-band-view';

/** 1st-round result band at the top of the home page (official TSE data). */
export async function FirstRoundBand() {
  const model = roundBand(await firstRoundNational().catch(() => null));
  return model ? <RoundBand model={model} /> : null;
}
