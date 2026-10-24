import geometry from '@/features/election/map/geometry.json';

// Illustrative tint by region, not results: the login page has no access to election data.
const tint: Record<string, string> = {
  Norte: '#176399',
  Nordeste: '#c6293e',
  'Centro-Oeste': '#176399',
  Sudeste: '#ce792f',
  Sul: '#176399',
};
const regions = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

/** Blurred, non-interactive sketch of the panel behind the login card. */
export function PanelPreview() {
  return (
    <div className="panel-preview" aria-hidden="true">
      <div className="panel-preview-top">
        <span className="panel-preview-brand" />
        <span className="panel-preview-search" />
        <span className="panel-preview-live">AO VIVO</span>
      </div>
      <div className="panel-preview-grid">
        <div className="panel-preview-card">
          <span className="panel-preview-title" />
          <span className="panel-preview-line is-short" />
          <div className="panel-preview-candidates">
            {['#176399', '#c6293e'].map((color) => (
              <div key={color} className="panel-preview-candidate">
                <span className="panel-preview-photo" style={{ background: color }} />
                <span className="panel-preview-number" />
                <span className="panel-preview-line" />
              </div>
            ))}
          </div>
          <div className="panel-preview-race">
            <span style={{ width: '52%', background: '#176399' }} />
            <span style={{ width: '48%', background: '#c6293e' }} />
          </div>
          <svg className="panel-preview-chart" viewBox="0 0 200 60" preserveAspectRatio="none">
            <polyline points="0,40 30,34 60,36 90,28 120,30 150,24 200,22" stroke="#176399" />
            <polyline points="0,22 30,28 60,26 90,32 120,30 150,35 200,37" stroke="#c6293e" />
          </svg>
        </div>
        <svg className="panel-preview-map" viewBox={geometry.viewBox}>
          {geometry.states.map((state) => (
            <path key={state.uf} d={state.path} fill={tint[state.region] ?? '#494940'} />
          ))}
        </svg>
        <div className="panel-preview-card">
          {regions.map((region, i) => (
            <div key={region} className="panel-preview-region">
              <span className="panel-preview-line" />
              <span className="panel-preview-bar">
                <span style={{ width: `${55 + ((i * 17) % 35)}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
