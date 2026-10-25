import type { ProjectionModel } from './projection-model';
import './projection-card.css';

const pct = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
const countedLabel = (value: number) =>
  `${Number.isInteger(value) ? value : pct(value)}%`;

/**
 * Inline card under the official TSE result. Gold border + labels so it is never
 * mistaken for a second official count (mobile and desktop).
 */
export function ProjectionCard({ model }: { model: ProjectionModel }) {
  return (
    <section className="projection-card" aria-labelledby="projection-card-title">
      <header className="projection-card-top">
        <h2 id="projection-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Projeção eleitoral
        </h2>
        <span className="projection-card-badge">Modelo próprio</span>
      </header>

      {model.state === 'unavailable' && (
        <div className="projection-card-wait">
          <span className="projection-card-hourglass" aria-hidden="true">
            ⌛
          </span>
          <p className="projection-card-wait-title">Aguardando dados suficientes</p>
          <p className="projection-card-wait-text">
            A projeção será disponibilizada quando houver cobertura suficiente da apuração.
          </p>
        </div>
      )}

      {model.state === 'estimate' && (
        <div className="projection-card-body">
          <p className="projection-card-lead">
            Se o ritmo atual se mantiver · <b>estimativa</b>
          </p>
          <div className="projection-card-pair">
            {[model.first, model.second].map((side) => (
              <div key={side.id} className="projection-card-side" style={{ '--side': side.color } as React.CSSProperties}>
                <span className="projection-card-name">{side.name}</span>
                <strong>
                  {pct(side.projectedPercentage)}
                  <small>%</small>
                </strong>
              </div>
            ))}
          </div>
          <div className="projection-card-bar" aria-hidden="true">
            <span
              style={{
                width: `${Math.min(100, Math.max(0, model.first.projectedPercentage))}%`,
                background: model.first.color,
              }}
            />
            <span
              style={{
                width: `${Math.min(100, Math.max(0, model.second.projectedPercentage))}%`,
                background: model.second.color,
              }}
            />
          </div>
          <p className="projection-card-meta">
            Apurado {countedLabel(model.counted)} · falta {countedLabel(model.remainingPercent)} ·
            gap {pct(model.gapPoints)} pp
          </p>
        </div>
      )}

      {model.state === 'final' && (
        <div className="projection-card-wait">
          <p className="projection-card-wait-title">Apuração encerrada</p>
          <p className="projection-card-wait-text">
            O resultado oficial do TSE está no card acima. A projeção não se aplica mais.
          </p>
        </div>
      )}

      <p className="projection-card-note">
        Estimativa estatística independente. Não representa resultado oficial do TSE.
      </p>
    </section>
  );
}
