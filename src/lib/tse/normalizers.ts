import { resultSchema } from './schemas';
import { photoUrl } from './urls';
import type { ElectionConfig, ElectionSnapshot, Scope } from './types';
export function officialDate(date: string, time: string): string | null {
  if (!date && !time) return null;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time))
    throw new Error('Invalid official timestamp');
  const [day, month, year] = date.split('/');
  const iso = `${year}-${month}-${day}T${time}-03:00`;
  if (!Number.isFinite(Date.parse(iso))) throw new Error('Invalid timestamp');
  return iso;
}
export function normalizeResult(
  input: unknown,
  config: ElectionConfig,
  scope: Scope,
  sourceUrl: string,
  /** TSE office code: 1 is President, 3 is Governor. */
  officeCode = 1,
): ElectionSnapshot {
  const r = resultSchema.parse(input);
  const expectedType =
    scope.type === 'country' ? 'br' : scope.type === 'municipality' ? 'mu' : 'uf';
  if (
    r.ele !== config.election ||
    r.t !== config.turn ||
    r.cdabr !== scope.code ||
    r.tpabr !== expectedType ||
    r.dv !== 's'
  )
    throw new Error('Result identity or disclosure mismatch');
  const office = r.carg.find((c) => Number(c.cd) === officeCode);
  if (!office || r.carg.length !== 1) throw new Error('Unexpected office');
  const generatedAt = officialDate(r.dg, r.hg);
  if (!generatedAt) throw new Error('Missing generation timestamp');
  const candidates = office.agr.flatMap((a) =>
    a.par.flatMap((p) =>
      p.cand.map((c) => ({
        id: c.sqcand,
        number: c.n,
        name: c.nm,
        ballotName: c.nmu,
        party: p.sg,
        coalition: a.tp === 'c' ? a.nm : null,
        federation: office.fed?.find((f) => f.n === p.nfed)?.nm ?? null,
        votes: c.vap,
        percentage: c.pvap,
        status: c.st || null,
        elected: c.e === 's' && c.st === 'Eleito',
        destination: c.dvt ?? null,
        imageUrl: photoUrl(config, c.sqcand, officeCode === 1 ? 'br' : scope.state),
        order: c.seq,
      })),
    ),
  );
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
    throw new Error('Duplicate candidates');
  candidates.sort((a, b) => b.votes - a.votes || a.order - b.order);
  return {
    version: r.idg,
    status: r.and === 'f' ? 'finished' : r.and === 'p' ? 'counting' : 'waiting',
    scope,
    candidates,
    source: 'TSE',
    sourceUrl,
    turn: config.turn,
    progress: {
      totalSections: r.s.ts,
      countedSections: r.s.st,
      percentageCounted: r.s.pst,
      eligibleVoters: r.e.te,
      turnout: r.e.c,
      abstentions: r.e.a,
      validVotes: r.v.vv,
      blankVotes: r.v.vb,
      nullVotes: r.v.tvn,
      generatedAt,
      totaledAt: officialDate(r.dt, r.ht),
      finished: r.and === 'f',
    },
  };
}
