import geometry from '@/features/election/map/geometry.json';

export type StateFill = Record<string, { color: string; opacity: number; label: string }>;

/**
 * Static map of the 27 states. Without fills it is the neutral map of the countdown; with fills
 * each state takes its leader's color (stronger for larger leads).
 */
export function BrazilMap({
  fills,
  locked = false,
  label,
}: {
  fills?: StateFill;
  locked?: boolean;
  label: string;
}) {
  const [, , width, height] = geometry.viewBox.split(' ').map(Number);
  return (
    <div className={locked ? 'brazil-map is-locked' : 'brazil-map'}>
      <svg viewBox={geometry.viewBox} role="img" aria-label={label}>
        {geometry.states.map((state) => {
          const fill = fills?.[state.uf];
          return (
            <path
              key={state.uf}
              d={state.path}
              fill={fill?.color ?? '#1d1d1a'}
              fillOpacity={fill ? fill.opacity : 1}
              className="brazil-map-state"
            >
              {fill && <title>{fill.label}</title>}
            </path>
          );
        })}
      </svg>
      {locked && (
        <span
          className="brazil-map-lock"
          style={{ left: `${(395 / width) * 100}%`, top: `${(330 / height) * 100}%` }}
          aria-hidden="true"
        >
          <svg width="26" height="26" viewBox="0 0 24 24">
            <rect
              x="5"
              y="11"
              width="14"
              height="10"
              rx="2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </span>
      )}
    </div>
  );
}
