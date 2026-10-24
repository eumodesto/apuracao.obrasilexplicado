import type { ElectionConfig, Scope } from './types';
const ORIGIN = 'https://resultados.tse.jus.br';
function directory(config: ElectionConfig, type: string, state = 'br') {
  const template = config.directories[type];
  if (!template || !/^[a-z]{2}$/.test(state)) throw new Error('Invalid official directory');
  const values: Record<string, string> = {
    base: ORIGIN,
    ambiente: 'oficial',
    ciclo: config.cycle,
    cd_eleicao: config.election,
    cd_pleito: config.contest,
    uf: state,
  };
  const expanded = template.replace(/<([^>]+)>/g, (_, key: string) => values[key] ?? '<invalid>');
  const url = new URL(expanded);
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    expanded.includes('<') ||
    !url.pathname.startsWith(`/oficial/${config.cycle}/${config.election}/`)
  )
    throw new Error('Untrusted directory');
  return url.href;
}
/** Result file of a place; `office` is the TSE office code (0001 President, 0003 Governor). */
export function resultUrl(config: ElectionConfig, scope: Scope, office = '0001') {
  if (scope.type === 'municipality' && !/^\d{5}$/.test(scope.code))
    throw new Error('Invalid municipality');
  const prefix = scope.type === 'municipality' ? scope.state + scope.code : scope.state;
  if (!/^\d{4}$/.test(office)) throw new Error('Invalid office');
  return `${directory(config, 'u', scope.state)}/${prefix}-c${office}-e${config.election.padStart(6, '0')}-u.json`;
}
export const geographyUrl = (c: ElectionConfig) =>
  `${directory(c, 'cm')}/mun-e${c.election.padStart(6, '0')}-cm.json`;
export const trackingUrl = (c: ElectionConfig, state: string) =>
  `${directory(c, 'ab', state)}/${state}-e${c.election.padStart(6, '0')}-ab.json`;
/** Candidate photo: national offices under `br`, state offices under the state. */
export function photoUrl(c: ElectionConfig, id: string, state = 'br') {
  if (!/^\d+$/.test(id)) throw new Error('Invalid candidate');
  return `${directory(c, 'ft', state)}/${id}.jpeg`;
}

/** Election code of an official TSE URL (`/oficial/<cycle>/<election>/…`), e.g. '6257'. */
export function electionOf(url: string) {
  return /^https:\/\/resultados\.tse\.jus\.br\/oficial\/ele\d{4}\/(\d+)\//.exec(url)?.[1] ?? null;
}
