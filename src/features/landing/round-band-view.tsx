import type { BandModel, BandSide } from './round-band-model';
import './round-band.css';

const pct = (value: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  );
const votes = (value: number) => `${new Intl.NumberFormat('pt-BR').format(value)} votos`;
/** "100%" when whole, "87,45%" otherwise. */
const counted = (value: number) => `${Number.isInteger(value) ? value : pct(value)}%`;
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

function Headline({ model }: { model: BandModel }) {
  const { first, second, text } = model.headline;
  const name = (side: BandSide) => (
    <span className="band-headline-name" style={{ '--side': side.color } as React.CSSProperties}>
      {side.name}
    </span>
  );
  return text === 'eleito' ? (
    <>{name(first)} é eleito no 1º turno</>
  ) : (
    <>
      {name(first)} e {name(second)} {text}
    </>
  );
}

export function RoundBand({
  model,
  label = 'Resultado do 1º turno para Presidente',
}: {
  model: BandModel;
  label?: string;
}) {
  const { left, right } = model;
  const style = (side: BandSide) => ({ '--side': side.color }) as React.CSSProperties;
  return (
    <section className="round-band" aria-label={label}>
      {/* Desktop: photos, names and one bar split at 50%. */}
      <div className="band-wide">
        <Photo side={left} />
        <div className="band-center">
          <div className="band-top">
            <p className="band-name" style={style(left)}>
              {left.name}{' '}
              <small>
                {left.party} {left.number}
              </small>
            </p>
            <p className="band-headline">
              <Headline model={model} />
            </p>
            <p className="band-name is-right" style={style(right)}>
              <small>
                {right.party} {right.number}
              </small>{' '}
              {right.name}
            </p>
          </div>
          <div
            className="band-bar"
            role="img"
            aria-label={`${left.name} ${pct(left.percentage)}%, ${right.name} ${pct(right.percentage)}% dos votos válidos`}
          >
            <span className="band-fill" style={{ ...style(left), width: `${left.percentage}%` }}>
              <b>
                {pct(left.percentage)}
                <small>%</small>
              </b>
              <em>{votes(left.votes)}</em>
            </span>
            <span
              className="band-fill is-right"
              style={{ ...style(right), width: `${right.percentage}%` }}
            >
              <em>{votes(right.votes)}</em>
              <b>
                {pct(right.percentage)}
                <small>%</small>
              </b>
            </span>
            <span className="band-half" aria-hidden="true">
              <i>50%</i>
            </span>
          </div>
        </div>
        <div className="band-right-column">
          <Photo side={right} />
          <p className="band-counted">
            <b>{counted(model.counted)}</b> apurado
          </p>
        </div>
        <span className="band-progress" style={{ width: `${model.counted}%` }} aria-hidden="true" />
      </div>

      {/* Phones: compact card without photos. */}
      <div className="band-card">
        <div className="band-card-top">
          <span>Brasil</span>
          <span className="band-pill">
            <i aria-hidden="true" />
            {model.headline.text === 'vão ao 2º turno'
              ? '2º turno'
              : model.headline.text === 'eleito'
                ? 'Eleito no 1º turno'
                : '1º turno'}
            {model.definedAt ? ` · definido às ${clock(model.definedAt)}` : ' · em apuração'}
          </span>
        </div>
        <div className="band-card-counted">
          <b>{counted(model.counted)}</b>
          <span>
            seções apuradas
            <small>
              {model.remainingSections === 0
                ? 'nada a apurar'
                : `faltam ${new Intl.NumberFormat('pt-BR').format(model.remainingSections)} seções`}
            </small>
          </span>
        </div>
        <div className="band-card-progress" aria-hidden="true">
          <span style={{ width: `${model.counted}%` }} />
        </div>
        <p className="band-headline">
          <Headline model={model} />
        </p>
        <div className="band-card-sides">
          {[left, right].map((side, index) => (
            <div
              key={side.id}
              className={index ? 'band-card-side is-right' : 'band-card-side'}
              style={style(side)}
            >
              <b>{side.name}</b>
              <small>
                {side.party} {side.number}
              </small>
              <strong>
                {pct(side.percentage)}
                <sup>%</sup>
              </strong>
              <span>{votes(side.votes)}</span>
            </div>
          ))}
        </div>
        <div className="band-card-bar" aria-hidden="true">
          <span style={{ background: left.color, width: `${left.percentage}%` }} />
          <span style={{ background: right.color, width: `${right.percentage}%` }} />
          <i />
        </div>
      </div>
    </section>
  );
}

function Photo({ side }: { side: BandSide }) {
  return (
    <span className="band-photo" style={{ background: side.color }}>
      {/* Decorative: the name is written next to it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/election/photo/${side.id}`} alt="" width={70} height={70} loading="lazy" />
    </span>
  );
}
