import { BrazilMap } from './brazil-map';
import { CountdownClock, NotifyForm } from './countdown-client';
import { SiteHeader } from './site-header';
import './landing.css';

/** Public page shown before the 2nd-round count opens. */
export function Countdown({ startsAt }: { startsAt: number }) {
  const date = new Date(startsAt);
  const day = date.toLocaleDateString('pt-BR', { day: 'numeric', timeZone: 'America/Sao_Paulo' });
  const when = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Sao_Paulo',
  });
  return (
    <div className="landing">
      <SiteHeader current="countdown" />
      <main className="landing-main" id="conteudo">
        <section className="landing-card" aria-labelledby="countdown-title">
          <p className="landing-eyebrow">2º turno · {when}</p>
          <h1 id="countdown-title">
            A apuração do 2º turno
            <br />
            abre aqui no dia {day}.
          </h1>
          <div className="landing-timer">
            <span>A contagem começa em</span>
            <CountdownClock startsAt={startsAt} />
          </div>
          <NotifyForm />
        </section>
        <BrazilMap locked label="Mapa do Brasil, bloqueado até o início da apuração" />
      </main>
    </div>
  );
}
