import { countStartsAt } from '@/lib/access/config';
import { firstRoundNational } from '@/lib/tse/first-round';
import { countedLabel, RaceCards } from './race-cards';
import { raceModel } from './race-model';

/** Left column with the official 1st-round result, shown until the 2nd-round count opens. */
export async function FirstRoundRace() {
  const model = raceModel(await firstRoundNational().catch(() => null));
  const startsAt = new Date(countStartsAt());
  const hour = startsAt.toLocaleTimeString('pt-BR', {
    hour: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });
  const date = startsAt.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Sao_Paulo',
  });
  // Without the TSE, an empty column keeps the grid in place.
  if (!model) return <div className="race-column" />;
  return (
    <RaceCards
      model={model}
      tag={`1º turno · ${countedLabel(model.counted)} apurado`}
      fact={{ label: '2º turno', value: `Em ${date}` }}
      // The curve is built from observations of the live count, so it starts on the 25th.
      series={[]}
      emptyChart={`A curva do 2º turno aparece aqui quando a apuração começar, em ${date}, às ${parseInt(hour, 10)}h.`}
    />
  );
}
