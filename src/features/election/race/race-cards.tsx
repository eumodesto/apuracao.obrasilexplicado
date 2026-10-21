import type { BandSide } from '@/features/landing/round-band-model';
import type { RaceCandidate, RaceModel } from './race-model';
import './race.css';

const decimal = (value: number, digits: number) =>
  new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
const whole = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
/** "100%" when whole, "37,52%" otherwise. */
export const countedLabel = (value: number) =>
  `${Number.isInteger(value) ? value : decimal(value, 2)}%`;
/** 2.224.965 → "2,2 milhões de votos"; 45.300 → "45 mil votos". */
function voteGap(votes: number) {
  if (votes >= 1_000_000) {
    const millions = votes / 1_000_000;
    return `${decimal(millions, 1)} ${millions < 2 ? 'milhão' : 'milhões'} de votos`;
  }
  if (votes >= 1_000) return `${whole(Math.round(votes / 1_000))} mil votos`;
  return `${whole(votes)} ${votes === 1 ? 'voto' : 'votos'}`;
}

/** One line of the chart: a candidate's share of valid votes as sections were counted. */
export type ChartSeries = {
  side: BandSide;
  /** x: sections counted (0–100); y: share of valid votes (0–100). */
  points: { x: number; y: number }[];
};

type Fact = { label: string; value: string; detail?: string };

/** Left column: the "Brasil" card and the "Ao longo da apuração" chart card. */
export function RaceCards({
  model,
  tag,
  fact,
  series,
  emptyChart,
  allCandidates = true,
  note,
}: {
  model: RaceModel;
  /** "1º turno · 100% apurado" */
  tag: string;
  /** Second line under "Diferença" (2nd-round date, or sections counted). */
  fact: Fact;
  series: ChartSeries[];
  /** Shown while the chart has fewer than two observations. */
  emptyChart: string;
  /** Link to the page with every candidate (the 1st-round result). */
  allCandidates?: boolean;
  note?: string;
}) {
  // With only the two finalists (the 2nd round), they are the rows of the card.
  const rows: RaceCandidate[] = model.others.length
    ? model.others
    : model.finalists.map((side) => ({
        id: side.id,
        name: side.name,
        party: `${side.party} ${side.number}`,
        color: side.color,
        percentage: side.percentage,
        votes: side.votes,
      }));
  return (
    <div className="race-column">
      <section className="race-card" aria-labelledby="race-title">
        <header className="race-card-top">
          <h1 id="race-title">Brasil</h1>
          <span className="race-tag">{tag}</span>
        </header>
        <dl className="race-facts">
          <div>
            <dt>Diferença</dt>
            <dd>
              {decimal(model.gap.points, 2)} pontos
              <small>{voteGap(model.gap.votes)}</small>
            </dd>
          </div>
          <div>
            <dt>{fact.label}</dt>
            <dd>
              <b>{fact.value}</b>
              {fact.detail && <small>{fact.detail}</small>}
            </dd>
          </div>
        </dl>
        {rows.length > 0 && (
          <ul className="race-others">
            {rows.map((candidate) => (
              <li key={candidate.id} style={{ '--side': candidate.color } as React.CSSProperties}>
                <span className="race-photo">
                  {/* Decorative: the name is written next to it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/election/photo/${candidate.id}`}
                    alt=""
                    width={36}
                    height={36}
                    loading="lazy"
                  />
                </span>
                <span className="race-who">
                  <b>{candidate.name}</b>
                  <small>{candidate.party}</small>
                </span>
                <span className="race-share">
                  <strong>{decimal(candidate.percentage, rows === model.others ? 1 : 2)}%</strong>
                  {candidate.votes != null && <small>{whole(candidate.votes)} votos</small>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {model.rest.count > 0 && (
          <p className="race-rest">
            Mais {model.rest.count}{' '}
            {model.rest.count === 1 ? 'candidatura soma' : 'candidaturas somam'}{' '}
            {decimal(model.rest.percentage, 1)}%
          </p>
        )}
        {allCandidates && model.others.length > 0 && (
          <a className="race-all" href="/resultado-1-turno">
            Todos os {model.total} candidatos
          </a>
        )}
        <dl className="race-stats">
          <div>
            <dt>Votos válidos</dt>
            <dd>{whole(model.validVotes)}</dd>
          </div>
          <div>
            <dt>Comparecimento</dt>
            <dd>{model.turnout == null ? '—' : `${decimal(model.turnout, 1)}%`}</dd>
          </div>
          <div>
            <dt>Brancos e nulos</dt>
            <dd>{model.blankAndNull == null ? '—' : `${decimal(model.blankAndNull, 1)}%`}</dd>
          </div>
        </dl>
        {note && <p className="race-note">{note}</p>}
      </section>
      <RaceChart sides={model.finalists} series={series} empty={emptyChart} />
    </div>
  );
}

/** Before the first valid votes: the same two cards, waiting. */
export function RaceWaiting({ tag, text }: { tag: string; text: string }) {
  return (
    <div className="race-column">
      <section className="race-card" aria-labelledby="race-title">
        <header className="race-card-top">
          <h1 id="race-title">Brasil</h1>
          <span className="race-tag">{tag}</span>
        </header>
        <p className="race-rest">{text}</p>
      </section>
      <RaceChart sides={null} series={[]} empty={text} />
    </div>
  );
}

/** Even-numbered scale around the observed values, at least 8 points tall and always with 50%. */
function scale(values: number[]) {
  const low = Math.min(50, ...values),
    high = Math.max(50, ...values);
  let min = Math.floor((low - 1) / 2) * 2,
    max = Math.ceil((high + 1) / 2) * 2;
  while (max - min < 8) {
    min -= 2;
    max += 2;
  }
  return { min: Math.max(0, min), max: Math.min(100, max) };
}

function RaceChart({
  sides,
  series,
  empty,
}: {
  sides: [BandSide, BandSide] | null;
  series: ChartSeries[];
  empty: string;
}) {
  const drawn = series.filter((s) => s.points.length >= 2);
  const { min, max } = scale(drawn.flatMap((s) => s.points.map((p) => p.y)));
  const step = (max - min) / 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => max - i * step);
  // The x axis runs to the last counted share, so the lines end at the right edge.
  const lastX = Math.max(1, ...drawn.flatMap((s) => s.points.map((p) => p.x)));
  const xMax = lastX > 50 ? 100 : Math.min(100, Math.ceil(lastX / 10) * 10);
  const px = (x: number) => (x / xMax) * 100;
  const py = (y: number) => ((max - y) / (max - min)) * 100;
  return (
    <section className="race-card race-chart-card" aria-labelledby="race-chart-title">
      <h2 id="race-chart-title">Ao longo da apuração</h2>
      {sides && (
        <ul className="race-legend">
          {sides.map((side) => (
            <li key={side.id} style={{ '--side': side.color } as React.CSSProperties}>
              {side.name}
            </li>
          ))}
        </ul>
      )}
      <div
        className="race-chart"
        role="img"
        aria-label={
          drawn.length
            ? drawn.map((s) => `${s.side.name}: ${decimal(s.points.at(-1)!.y, 2)}%`).join(', ') +
              ' dos votos válidos na última observação'
            : empty
        }
      >
        <div className="race-chart-grid" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className={tick === 50 ? 'is-half' : undefined}>
              <small>{whole(tick)}%</small>
            </span>
          ))}
        </div>
        {drawn.length > 0 ? (
          <div className="race-chart-plot" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              {drawn.map((s) => (
                <polyline
                  key={s.side.id}
                  points={s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
                  fill="none"
                  stroke={s.side.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {drawn.map((s) => {
              const last = s.points.at(-1)!;
              return (
                <i
                  key={s.side.id}
                  style={{
                    left: `${px(last.x)}%`,
                    top: `${py(last.y)}%`,
                    background: s.side.color,
                  }}
                />
              );
            })}
          </div>
        ) : (
          <p>{empty}</p>
        )}
        <div className="race-chart-axis" aria-hidden="true">
          <small>0% das seções</small>
          <small>{whole(xMax / 2)}%</small>
          <small>{whole(xMax)}%</small>
        </div>
      </div>
    </section>
  );
}
