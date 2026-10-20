import type { Metadata } from 'next';
import Link from 'next/link';
import { BrazilMap, type StateFill } from '@/features/landing/brazil-map';
import { SiteHeader } from '@/features/landing/site-header';
import { dateTime, number, percent } from '@/lib/format';
import { firstRound, type RoundPlace } from '@/lib/tse/first-round';
import '@/features/landing/landing.css';
import './first-round.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Resultado do 1º turno — Resultados Brasil',
  description: 'Resultado oficial do 1º turno para Presidente em 2026, com dados do TSE.',
};

/** Stronger color for larger leads: 40% or less is light, 80% or more is full. */
const opacityFor = (percentage: number) =>
  0.35 + Math.min(Math.max((percentage - 40) / 40, 0), 1) * 0.65;

export default async function FirstRoundPage() {
  const result = await firstRound().catch((error) => {
    console.error('[first-round] unavailable', error);
    return null;
  });
  const national = result?.national ?? null;
  const analysis = result?.analysis ?? null;

  if (!result?.available || !national) return <Unavailable />;

  const statusById = new Map(national.candidates.map((c) => [c.id, c.status]));
  const fills: StateFill = Object.fromEntries(
    result.places
      .filter((place): place is RoundPlace & { leader: NonNullable<RoundPlace['leader']> } =>
        Boolean(place.leader),
      )
      .map((place) => [
        place.uf,
        {
          color: place.leader.color,
          opacity: opacityFor(place.leader.percentage),
          label: `${place.name}: ${place.leader.name} (${place.leader.number}) com ${percent(place.leader.percentage)}%`,
        },
      ]),
  );
  const progress = national.progress;
  const top = analysis?.candidates.slice(0, 2) ?? [];

  return (
    <div className="landing round">
      <SiteHeader current="first-round" />
      <main className="round-main" id="conteudo">
        <section className="round-hero">
          <p className="landing-eyebrow">1º turno · domingo, 4 de outubro de 2026</p>
          <h1>Resultado do 1º turno para Presidente</h1>
          <p className="round-source">
            {percent(progress.percentageCounted)}% das seções totalizadas
            {national.status === 'finished'
              ? ' · apuração encerrada'
              : ' · apuração em andamento'}{' '}
            · dado oficial de {dateTime(progress.totaledAt ?? progress.generatedAt)} · fonte:{' '}
            <a href="https://resultados.tse.jus.br/" target="_blank" rel="noreferrer">
              TSE
            </a>
          </p>
        </section>

        <div className="round-grid">
          <section className="round-panel" aria-labelledby="round-candidates">
            <h2 id="round-candidates">Votos válidos</h2>
            {analysis ? (
              <ol className="round-candidates">
                {analysis.candidates.map((candidate, index) => {
                  const status = statusById.get(candidate.id);
                  return (
                    <li
                      key={candidate.id}
                      className={index < 2 ? 'round-candidate is-top' : 'round-candidate'}
                      style={{ '--candidate': candidate.color } as React.CSSProperties}
                    >
                      <div className="round-candidate-line">
                        <span className="round-number">{candidate.number}</span>
                        <span className="round-name">
                          {candidate.name}
                          {status && (/turno/i.test(status) || status === 'Eleito') && (
                            <small className="round-status">{status}</small>
                          )}
                        </span>
                        <strong>{percent(candidate.percentage)}%</strong>
                      </div>
                      <div className="round-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(candidate.percentage, 0.3)}%` }} />
                      </div>
                      <span className="round-votes">{number(candidate.votes)} votos</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="round-muted">Os votos válidos ainda não estão disponíveis.</p>
            )}
            <dl className="round-stats">
              <div>
                <dt>Comparecimento</dt>
                <dd>{number(progress.turnout)}</dd>
              </div>
              <div>
                <dt>Abstenção</dt>
                <dd>{number(progress.abstentions)}</dd>
              </div>
              <div>
                <dt>Brancos</dt>
                <dd>{number(progress.blankVotes)}</dd>
              </div>
              <div>
                <dt>Nulos</dt>
                <dd>{number(progress.nullVotes)}</dd>
              </div>
            </dl>
          </section>

          <section className="round-panel round-map" aria-labelledby="round-map-title">
            <h2 id="round-map-title">Quem liderou em cada estado</h2>
            <BrazilMap
              fills={fills}
              label="Mapa do Brasil com o candidato mais votado em cada estado no 1º turno"
            />
            <p className="round-legend">
              {top.map((candidate) => (
                <span key={candidate.id}>
                  <i style={{ background: candidate.color }} aria-hidden="true" />
                  {candidate.number} · {candidate.name}
                </span>
              ))}
              <span className="round-muted">Cor mais forte, vantagem maior</span>
            </p>
          </section>
        </div>

        <section className="round-panel" aria-labelledby="round-states">
          <h2 id="round-states">Por estado</h2>
          <table className="round-table">
            <thead>
              <tr>
                <th scope="col">Estado</th>
                <th scope="col">Mais votado</th>
                <th scope="col" className="is-number">
                  % dos válidos
                </th>
                <th scope="col" className="is-number">
                  Totalizado
                </th>
              </tr>
            </thead>
            <tbody>
              {[...result.places, ...(result.exterior ? [result.exterior] : [])].map((place) => (
                <tr key={place.uf}>
                  <th scope="row">{place.name}</th>
                  <td>
                    {place.leader ? (
                      <span className="round-leader">
                        <i style={{ background: place.leader.color }} aria-hidden="true" />
                        {place.leader.number} · {place.leader.name}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="is-number">
                    {place.leader ? `${percent(place.leader.percentage)}%` : '—'}
                  </td>
                  <td className="is-number">
                    {place.snapshot
                      ? `${percent(place.snapshot.progress.percentageCounted)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="round-back">
          <Link href="/">Acompanhar o 2º turno ao vivo →</Link>
        </p>
      </main>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="landing round">
      <SiteHeader current="first-round" />
      <main className="round-main round-unavailable" id="conteudo">
        <section className="landing-card">
          <p className="landing-eyebrow">1º turno · domingo, 4 de outubro de 2026</p>
          <h1>Resultado do 1º turno</h1>
          <p className="round-muted">
            Os dados oficiais do TSE estão temporariamente indisponíveis. Tente de novo em alguns
            minutos.
          </p>
          <p className="round-back">
            <Link href="/resultado-1-turno">Tentar de novo</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
