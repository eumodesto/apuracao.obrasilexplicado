import type { RegionRowModel } from '@/lib/tse/region-rows';
import './region-board.css';

const pct = (value: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    value,
  );
/** "100%" when whole, "87,4%" otherwise. */
const counted = (value: number | null) =>
  value == null ? '—' : `${Number.isInteger(value) ? value : pct(value)}%`;

function Globe() {
  return (
    <svg className="rb-globe" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13M8 1.5c2 2 2.8 4.2 2.8 6.5S10 12.5 8 14.5M8 1.5C6 3.5 5.2 5.7 5.2 8S6 12.5 8 14.5" />
    </svg>
  );
}

/** One region: name and progress on the left; leader photo, party, share and a 50% bar on the right. */
export function RegionRow({ row, exterior = false }: { row: RegionRowModel; exterior?: boolean }) {
  const { leader } = row;
  return (
    <span className="rb-row">
      <span className="rb-name">
        <b>
          {exterior && <Globe />}
          {row.name}
        </b>
        <small>{counted(row.counted)} apurado</small>
      </span>
      {leader ? (
        <span
          className="rb-score"
          style={{ '--side': leader.color } as React.CSSProperties}
          aria-label={`${leader.name}, ${leader.party}, ${pct(leader.percentage)}%`}
        >
          <span className="rb-photo">
            {/* Decorative: the party and share are written next to it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/election/photo/${leader.id}`} alt="" width={28} height={28} />
          </span>
          <span className="rb-figures">
            <span className="rb-top">
              <small>{leader.party}</small>
              <b>{pct(leader.percentage)}%</b>
            </span>
            <span className="rb-bar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, leader.percentage)}%` }} />
              <em />
            </span>
          </span>
        </span>
      ) : (
        <span className="rb-score is-empty">—</span>
      )}
    </span>
  );
}

/** Compact "Por região" card (five regions plus abroad). */
export function RegionBoard({
  regions,
  exterior,
  tag,
  onExterior,
}: {
  regions: RegionRowModel[];
  exterior: RegionRowModel | null;
  /** Small label next to the title, e.g. "1º turno". */
  tag?: string;
  /** Live panel: opens the results abroad. */
  onExterior?: () => void;
}) {
  return (
    <section className="region-board" aria-label="Resultado por região">
      <h2>
        Por região
        {tag && <small>{tag}</small>}
      </h2>
      <ul>
        {regions.map((row) => (
          <li key={row.name}>
            <RegionRow row={row} />
          </li>
        ))}
      </ul>
      {exterior &&
        (onExterior ? (
          <button
            type="button"
            className="rb-exterior"
            onClick={onExterior}
            aria-label="Ver resultados do exterior"
          >
            <RegionRow row={exterior} exterior />
          </button>
        ) : (
          <div className="rb-exterior">
            <RegionRow row={exterior} exterior />
          </div>
        ))}
    </section>
  );
}
