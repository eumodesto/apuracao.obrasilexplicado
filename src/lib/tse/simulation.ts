/**
 * Local simulation of the 2nd-round count (`TSE_SIMULATION=1`, never in production).
 *
 * When the site asks the TSE for a 2nd-round file, this transport builds it in the official
 * format: it starts from the real 2nd-round file (already published, with zero votes) and fills
 * it with the real 1st-round votes of the same two candidates, counted progressively. Each state
 * advances at its own pace (South and Southeast first, North and Northeast later, as on election
 * night), and the national file is the sum of the states and abroad, so every screen agrees.
 * Everything else (1st round, config, zones, photos) passes through to the TSE untouched.
 */
import states from '../../../data/geography/ufs.json';
import { CONFIG_URL } from './config';

type Json = Record<string, unknown>;
type Cand = { sqcand: string; vap: string; pvap: string; st: string; e: string; dvt?: string };
type ResultFile = Json & {
  ele: string;
  dg: string;
  hg: string;
  idg: string;
  dt: string;
  ht: string;
  and: string;
  s: Json & { ts: string; st: string; pst: string };
  e: Json & { te?: string; c?: string; a?: string };
  v: Json & { vv?: string; vb?: string; tvn?: string; tv?: string };
  carg: { cd: string; agr: { par: { cand: Cand[] }[] }[] }[];
};

const ORIGIN = 'https://resultados.tse.jus.br';
const RESULT =
  /^\/oficial\/(ele\d{4})\/(\d+)\/dados\/([a-z]{2})\/([a-z]{2})(\d{5})?-c(\d{4})-e(\d{6})-u\.json$/;
const TRACKING = /^\/oficial\/(ele\d{4})\/(\d+)\/dados\/br\/br-e(\d{6})-ab\.json$/;
/** The TSE publishes in batches; the simulation advances in steps of this size. */
const STEP_MS = 15_000;

export const simulationEnabled = () =>
  process.env.TSE_SIMULATION === '1' && process.env.NODE_ENV !== 'production';

const runtime = globalThis as typeof globalThis & { tseSimulationStart?: number };
const durationMs = () => {
  const minutes = Number(process.env.TSE_SIMULATION_MINUTES);
  return (Number.isFinite(minutes) && minutes >= 1 ? minutes : 10) * 60_000;
};

/** Stable 0–1 number per key, so each state keeps its pace across requests. */
function noise(key: string) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 10_000) / 10_000;
}

const regionOf = new Map(states.map((s) => [s.sigla.toLowerCase(), s.regiao.nome]));
/** When each region starts and how long it takes, as fractions of the whole simulation. */
const PACE: Record<string, { start: number; length: number }> = {
  Sul: { start: 0, length: 0.55 },
  Sudeste: { start: 0.02, length: 0.6 },
  'Centro-Oeste': { start: 0.04, length: 0.6 },
  Norte: { start: 0.1, length: 0.7 },
  Nordeste: { start: 0.12, length: 0.75 },
  Exterior: { start: 0.2, length: 0.6 },
};

/** Share of a state's sections counted now (0–1). */
export function stateProgress(uf: string, elapsedMs: number, totalMs = durationMs()) {
  const pace = PACE[uf === 'zz' ? 'Exterior' : (regionOf.get(uf) ?? 'Sudeste')];
  const start = pace.start + noise(`start:${uf}`) * 0.08;
  const length = Math.min(pace.length + noise(`length:${uf}`) * 0.15, 1 - start);
  const time = Math.floor(elapsedMs / STEP_MS) * STEP_MS;
  return Math.max(0, Math.min(1, (time / totalMs - start) / length));
}

/** A municipality runs a little ahead of or behind its state, and ends with it. */
function municipalProgress(uf: string, code: string, stateShare: number) {
  if (stateShare >= 1) return 1;
  return Math.max(0, Math.min(0.999, stateShare * (0.7 + 0.6 * noise(`mun:${uf}${code}`))));
}

const percent = (part: number, whole: number) =>
  (whole ? (part / whole) * 100 : 0).toFixed(2).replace('.', ',');
const scaled = (value: string | undefined, share: number) =>
  String(Math.round(Number(value ?? 0) * share));
function brasilia(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.day}/${parts.month}/${parts.year}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}
const candidatesOf = (file: ResultFile) =>
  file.carg[0].agr.flatMap((a) => a.par.flatMap((p) => p.cand));

/** Counted totals of one place at a given share, from its 1st-round file. */
type Counted = {
  sections: number;
  votes: Map<string, number>;
  blank: number;
  nulls: number;
  turnout: number;
  abstentions: number;
};
function countedOf(
  first: ResultFile,
  finalists: string[],
  totalSections: number,
  share: number,
): Counted {
  const votes = new Map(
    finalists.map((id) => {
      const candidate = candidatesOf(first).find((c) => c.sqcand === id);
      return [id, Math.round(Number(candidate?.vap ?? 0) * share)];
    }),
  );
  return {
    sections: Math.round(totalSections * share),
    votes,
    blank: Number(scaled(first.v.vb, share)),
    nulls: Number(scaled(first.v.tvn, share)),
    turnout: Number(scaled(first.e.c, share)),
    abstentions: Number(scaled(first.e.a, share)),
  };
}

/** Writes counted totals into a copy of the official 2nd-round file. */
function fill(template: ResultFile, counted: Counted, now: Date, decide: boolean): ResultFile {
  const file = structuredClone(template);
  const stamp = brasilia(now);
  const share = Number(file.s.ts) ? counted.sections / Number(file.s.ts) : 0;
  const valid = [...counted.votes.values()].reduce((sum, v) => sum + v, 0);
  file.dg = stamp.date;
  file.hg = stamp.time;
  // A new version for every batch, like the TSE's generation id.
  file.idg = String(1_000_000 + Math.round(share * 100_000));
  file.and = share >= 1 ? 'f' : counted.sections > 0 ? 'p' : 'n';
  file.dt = counted.sections > 0 ? stamp.date : '';
  file.ht = counted.sections > 0 ? stamp.time : '';
  file.s = {
    ...file.s,
    st: String(counted.sections),
    pst: percent(counted.sections, Number(file.s.ts)),
  };
  file.e = { ...file.e, c: String(counted.turnout), a: String(counted.abstentions) };
  file.v = {
    ...file.v,
    vv: String(valid),
    vb: String(counted.blank),
    tvn: String(counted.nulls),
    tv: String(valid + counted.blank + counted.nulls),
  };
  const ranked = [...counted.votes.entries()].sort((a, b) => b[1] - a[1]);
  for (const candidate of candidatesOf(file)) {
    const votes = counted.votes.get(candidate.sqcand) ?? 0;
    candidate.vap = String(votes);
    candidate.pvap = percent(votes, valid);
    candidate.dvt = 'Válido';
    const won = decide && share >= 1 && ranked[0]?.[0] === candidate.sqcand;
    candidate.st = decide && share >= 1 ? (won ? 'Eleito' : 'Não eleito') : '';
    candidate.e = won ? 's' : 'n';
  }
  return file;
}

export function simulatedTransport(real: typeof fetch): typeof fetch {
  const files = new Map<string, Promise<ResultFile>>();
  /** Official files are fetched once: the 1st round is final and the 2nd-round templates are empty. */
  const official = (url: string) => {
    let file = files.get(url);
    if (!file) {
      file = real(url, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(
        async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as ResultFile;
        },
      );
      file.catch(() => files.delete(url));
      files.set(url, file);
    }
    return file;
  };
  /** 2nd-round election code → 1st-round code of the same kind (President, Governor…). */
  let pairs: Promise<Map<string, string>> | null = null;
  const firstRoundOf = async (election: string) => {
    pairs ??= official(CONFIG_URL)
      .then((config) => {
        const elections = (
          config as unknown as { pl: { c: string; e: { cd: string; t: string; tp: string }[] }[] }
        ).pl
          .filter((p) => p.c === 'ele2026')
          .flatMap((p) => p.e);
        return new Map(
          elections
            .filter((e) => e.t === '2')
            .flatMap((second) => {
              const first = elections.find((e) => e.t === '1' && e.tp === second.tp);
              return first ? [[second.cd, first.cd] as const] : [];
            }),
        );
      })
      .catch((error) => {
        pairs = null;
        throw error;
      });
    return (await pairs).get(String(Number(election)));
  };
  const firstUrl = (url: URL, second: string, first: string) =>
    `${ORIGIN}${url.pathname
      .replace(`/${second}/`, `/${first}/`)
      .replace(`-e${second.padStart(6, '0')}-`, `-e${first.padStart(6, '0')}-`)}`;

  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.origin !== ORIGIN) return real(input, init);
    const result = RESULT.exec(url.pathname);
    const tracking = TRACKING.exec(url.pathname);
    const election = result?.[2] ?? tracking?.[2];
    const first = election && (await firstRoundOf(election));
    if (!first || !election) return real(input, init);
    const start = (runtime.tseSimulationStart ??= Date.now());
    const now = new Date();
    const elapsed = now.getTime() - start;
    const respond = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });

    if (tracking) {
      const template = structuredClone(await official(url.href)) as unknown as Json & {
        dg: string;
        hg: string;
        abr: (Json & {
          cdabr: string;
          tpabr: string;
          and: string;
          dt?: string;
          ht?: string;
          s: Json & { ts: string };
        })[];
      };
      const stamp = brasilia(now);
      template.dg = stamp.date;
      template.hg = stamp.time;
      for (const place of template.abr) {
        if (place.tpabr !== 'uf') continue;
        const share = stateProgress(place.cdabr, elapsed);
        const counted = Math.round(Number(place.s.ts) * share);
        place.and = share >= 1 ? 'f' : counted > 0 ? 'p' : 'n';
        place.dt = counted > 0 ? stamp.date : '';
        place.ht = counted > 0 ? stamp.time : '';
        place.s = { ...place.s, st: String(counted), pst: percent(counted, Number(place.s.ts)) };
      }
      return respond(template);
    }

    const [, , , uf, , town] = result!;
    const template = await official(url.href);
    const finalists = candidatesOf(template).map((c) => c.sqcand);
    // Only the files that decide a race say 'Eleito': Brazil for President, the state for Governor.
    const decide =
      template.tpabr === 'br' || (template.tpabr === 'uf' && template.carg[0].cd !== '1');
    if (uf !== 'br') {
      const stateShare = stateProgress(uf, elapsed);
      const share = town ? municipalProgress(uf, town, stateShare) : stateShare;
      const counted = countedOf(
        await official(firstUrl(url, election, first)),
        finalists,
        Number(template.s.ts),
        share,
      );
      return respond(fill(template, counted, now, decide));
    }
    // Brazil: the sum of every state and abroad, each at its own pace.
    const places = [...states.map((s) => s.sigla.toLowerCase()), 'zz'];
    const total: Counted = {
      sections: 0,
      votes: new Map(),
      blank: 0,
      nulls: 0,
      turnout: 0,
      abstentions: 0,
    };
    const counts = await Promise.all(
      places.map(async (place) => {
        const placeUrl = new URL(url.href.replace(/\/dados\/br\/br-/, `/dados/${place}/${place}-`));
        const [placeTemplate, placeFirst] = await Promise.all([
          official(placeUrl.href),
          official(firstUrl(placeUrl, election, first)),
        ]);
        return countedOf(
          placeFirst,
          finalists,
          Number(placeTemplate.s.ts),
          stateProgress(place, elapsed),
        );
      }),
    );
    for (const counted of counts) {
      total.sections += counted.sections;
      total.blank += counted.blank;
      total.nulls += counted.nulls;
      total.turnout += counted.turnout;
      total.abstentions += counted.abstentions;
      for (const [id, votes] of counted.votes)
        total.votes.set(id, (total.votes.get(id) ?? 0) + votes);
    }
    return respond(fill(template, total, now, decide));
  };
}

/** Where TSE files and the observed history are kept; the simulation never touches the real one. */
export const tseCacheDir = () =>
  simulationEnabled() ? '.cache/tse-simulacao' : process.env.TSE_CACHE_DIR || '.cache/tse';
