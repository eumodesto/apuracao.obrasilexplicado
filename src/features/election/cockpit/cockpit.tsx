'use client';
import { publishNational } from '@/features/election/live-summary';
import { CountTimeline } from './count-timeline';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from '@/components/brand';
import { WhatsAppShare } from '../whatsapp-share';
import { GovernorBoard } from '../governors/governor-board';
import { candidateColor } from '@/lib/tse/candidate-colors';
import { percent, number, time, roundLabel } from '@/lib/format';
import { useElection } from '../use-election';
import type { CandidateResult, ElectionResponse, Geography } from '@/lib/tse/types';
import type { CockpitFrame } from '@/lib/tse/cockpit-history';
import type { MunicipalMetric } from '@/lib/tse/municipal-map';
import { CockpitMap, type MapMode } from './map';
import { useZones } from './use-zones';
import { zoneLabel, zoneNeighborhood, zoneNeighborhoodSource } from './zone-labels';
import './cockpit.css';
import './editorial.css';
import { editorialName } from './editorial-name';
import { OnlinePartiesBadge } from '@/features/chat/online-parties';
import { RoundBand } from '@/features/landing/round-band-view';
import { roundBand } from '@/features/landing/round-band-model';
import { countedLabel, RaceCards, RaceWaiting, type ChartSeries } from '../race/race-cards';
import { raceModel } from '../race/race-model';
import { RegionBoard } from '../regions/region-board';
import { aggregateRegion, REGION_NAMES, type RegionRowModel } from '@/lib/tse/region-rows';
type Moment = {
  id: string;
  observedAt: string;
  officialAt: string;
  counted: number;
  sections: number;
  candidates: {
    id: string;
    number: string;
    name: string;
    percentage: number;
    votes: number;
    color: string;
  }[];
};
type Payload = {
  frame: CockpitFrame | null;
  timeline: Moment[];
  durable: boolean;
  temporary: boolean;
};
type Selection = {
  zone: string;
  uf: string;
  town: string;
  candidate: string;
  mode: MapMode;
  exterior: boolean;
};
const modes: MapMode[] = ['states', 'municipalities', 'margin', 'counted', 'candidate'];
const empty: Selection = {
  zone: '',
  uf: '',
  town: '',
  candidate: '',
  mode: 'states',
  exterior: false,
};
const normalized = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
function BrasiliaClock() {
  const [clock, setClock] = useState<string>();
  useEffect(() => {
    const update = () => setClock(new Date().toISOString());
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    window.addEventListener('focus', update);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, []);
  return (
    <span aria-label="Horário atual de Brasília" title="Horário atual de Brasília">
      {time(clock)}
    </span>
  );
}
function Portrait({ candidate }: { candidate: CandidateResult }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="portrait-fallback">{candidate.ballotName.slice(0, 1)}</span>
  ) : (
    <Image
      unoptimized
      src={`/api/election/photo/${candidate.id}`}
      alt={candidate.ballotName}
      onError={() => setFailed(true)}
      width={56}
      height={64}
      loading="lazy"
    />
  );
}
const MAP_NOTICE = 'A consulta do mapa está indisponível. O último mapa recebido foi preservado.';
/** Warnings go away on their own: they are about a moment, not a state to keep on screen. */
const NOTICE_MS = 10_000;

/**
 * The moments the race chart draws: only the latest run of the count (a drop in the counted share
 * means the history started over, e.g. a correction or a new count), ordered by counted share and
 * one per share, so the curve always moves left to right.
 */
export function chartMoments<T extends { counted: number }>(moments: T[]): T[] {
  let start = 0;
  for (let i = 1; i < moments.length; i++)
    if (moments[i].counted < moments[i - 1].counted - 0.5) start = i;
  const byShare = new Map<number, T>();
  for (const moment of moments.slice(start)) byShare.set(moment.counted, moment);
  return [...byShare.values()].sort((a, b) => a.counted - b.counted);
}

export function ElectionCockpit({
  initial,
  regions,
  band,
}: {
  initial: ElectionResponse;
  regions: Geography[];
  band?: React.ReactNode;
}) {
  const [visibleMunicipalStates, setVisibleMunicipalStates] = useState<string[]>([]);
  const onVisibleStates = useCallback(
    (states: string[]) =>
      setVisibleMunicipalStates((p) => (p.join(',') === states.join(',') ? p : states)),
    [],
  );
  const [hoveredZone, setHoveredZone] = useState('');
  const [selection, setSelection] = useState<Selection>(empty);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [historical, setHistorical] = useState<CockpitFrame | null>(null);
  const [historyId, setHistoryId] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [municipal, setMunicipal] = useState<MunicipalMetric[]>([]);
  const [municipalProgress, setMunicipalProgress] = useState('');
  const [info, setInfo] = useState(false);
  const [now, setNow] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const etag = useRef('');
  const live = useElection('scope=br', initial);
  // The chat on phones shows a live summary from this same poll.
  useEffect(() => publishNational(live.data), [live.data]);
  const abroad = useElection(historyId ? null : 'scope=exterior');
  const detailQuery = selection.exterior
    ? selection.town
      ? `scope=exterior&municipality=${selection.town}`
      : 'scope=exterior'
    : selection.uf
      ? `state=${selection.uf}${selection.town ? `&municipality=${selection.town}` : ''}`
      : null;
  const detail = useElection(historyId ? null : detailQuery);
  const current = historyId ? historical?.national : live.data;
  const snapshot = current?.snapshot;
  const map = historyId ? (historical?.map ?? null) : (payload?.frame?.map ?? null);
  const metrics = useMemo(() => {
    if (historyId) return historical?.municipalities ?? [];
    const received = [
      ...new Map(
        [...(payload?.frame?.municipalities ?? []), ...municipal].map((m) => [m.uf + m.code, m]),
      ).values(),
    ];
    const selected = detail.data.snapshot;
    if (!selected || selected.scope.type !== 'municipality' || selected.scope.state === 'zz')
      return received;
    const metric: MunicipalMetric = {
      code: selected.scope.code,
      uf: selected.scope.state,
      name: selected.scope.name,
      version: selected.version,
      updatedAt: selected.progress.totaledAt ?? selected.progress.generatedAt,
      counted: selected.progress.percentageCounted,
      validVotes: selected.progress.validVotes,
      stale: detail.data.stale,
      candidates: selected.candidates.map((c) => ({
        id: c.id,
        number: c.number,
        name: c.ballotName,
        votes: c.votes,
        percentage: c.percentage,
        color: candidateColor(c),
      })),
    };
    return [...received.filter((m) => m.uf !== metric.uf || m.code !== metric.code), metric];
  }, [
    historyId,
    historical,
    municipal,
    payload?.frame?.municipalities,
    detail.data.snapshot,
    detail.data.stale,
  ]);
  const selectedRegion = regions.find((r) => r.code === (selection.exterior ? 'zz' : selection.uf));
  const selectedTown = selectedRegion?.municipalities.find((m) => m.code === selection.town);
  const zoneData = useZones(
    selection.exterior ? '' : selection.uf,
    selection.town,
    selectedTown?.zones ?? [],
    !!historyId,
  );
  const selectedName =
    selectedTown?.name ?? (selection.exterior ? 'Exterior' : (selectedRegion?.name ?? 'Brasil'));
  const updateSelection = (next: Partial<Selection>) => {
    setSelection((s) => ({
      ...s,
      ...next,
      zone:
        next.zone ??
        (next.uf !== undefined || next.town !== undefined || next.exterior !== undefined
          ? ''
          : s.zone),
    }));
    setHoveredZone('');
    setNotice('');
    setSearchOpen(false);
  };
  const select = (uf: string, town = '') => updateSelection({ uf, town, exterior: false });
  useEffect(() => {
    const timer = setTimeout(() => {
      const p = new URLSearchParams(location.search);
      const uf = p.get('state')?.toLowerCase() ?? '';
      const region = regions.find((r) => r.code === uf);
      const town = p.get('municipality') ?? '';
      const mode = p.get('view') as MapMode;
      setSelection({
        zone: region?.municipalities
          .find((m) => m.code === town)
          ?.zones?.includes(p.get('zone') ?? '')
          ? (p.get('zone') ?? '')
          : '',
        uf: region && uf !== 'zz' ? uf : '',
        town: regions
          .find((r) => r.code === (p.get('scope') === 'exterior' ? 'zz' : uf))
          ?.municipalities.some((m) => m.code === town)
          ? town
          : '',
        exterior: p.get('scope') === 'exterior',
        candidate: p.get('candidate') ?? '',
        mode: modes.includes(mode) ? mode : p.get('candidate') ? 'candidate' : 'states',
      });
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [regions]);
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams();
    if (selection.uf) params.set('state', selection.uf.toUpperCase());
    if (selection.town) params.set('municipality', selection.town);
    if (selection.zone) params.set('zone', selection.zone);
    if (selection.exterior) params.set('scope', 'exterior');
    if (selection.mode !== 'states') params.set('view', selection.mode);
    if (selection.candidate) params.set('candidate', selection.candidate);
    history.replaceState(null, '', params.size ? '?' + params.toString() : '/');
  }, [selection, ready]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        if (!document.hidden) {
          const response = await fetch('/api/election/president/cockpit', {
            headers: etag.current ? { 'If-None-Match': etag.current } : {},
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
          });
          if (response.status !== 304) {
            if (!response.ok) throw new Error();
            const next: Payload = await response.json();
            if (!stopped) {
              setPayload(next);
              etag.current = response.headers.get('etag') ?? '';
            }
          }
          // The map answers again: the warning about it no longer applies.
          if (!stopped) setNotice((current) => (current === MAP_NOTICE ? '' : current));
        }
      } catch {
        if (!stopped) setNotice(MAP_NOTICE);
      } finally {
        if (!stopped) timer = setTimeout(poll, 20000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!ready || historyId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const hydrate = async () => {
      try {
        if (!document.hidden) {
          const response = await fetch('/api/election/president/municipalities?state=br', {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
          });
          if (response.status === 304) return;
          if (!response.ok) throw new Error();
          const data: { results: MunicipalMetric[]; available: number; total: number } =
            await response.json();
          if (!stopped) {
            setMunicipal((previous) => [
              ...new Map([...previous, ...data.results].map((m) => [m.uf + m.code, m])).values(),
            ]);
            setMunicipalProgress(
              `${data.available} de ${data.total} resultados municipais recebidos`,
            );
          }
        }
      } catch {
        /* Keep every result already received; the UF loop continues independently. */
      } finally {
        if (!stopped) timer = setTimeout(hydrate, 30000);
      }
    };
    void hydrate();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [ready, historyId]);
  useEffect(() => {
    if (
      !ready ||
      historyId ||
      selection.exterior ||
      (!selection.uf && selection.mode !== 'municipalities' && !visibleMunicipalStates.length)
    )
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const states = selection.uf
      ? [selection.uf]
      : visibleMunicipalStates.length
        ? visibleMunicipalStates
        : regions.filter((r) => !['br', 'zz'].includes(r.code)).map((r) => r.code);
    let index = 0;
    const poll = async () => {
      const uf = states[index % states.length];
      if (!uf) return;
      try {
        if (!document.hidden) {
          const response = await fetch(`/api/election/president/municipalities?state=${uf}`, {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]),
          });
          if (response.status === 304) return;
          if (!response.ok) throw new Error();
          const data: { results: MunicipalMetric[]; available: number; total: number } =
            await response.json();
          if (!stopped) {
            setMunicipal((previous) => [
              ...new Map([...previous, ...data.results].map((m) => [m.uf + m.code, m])).values(),
            ]);
            setMunicipalProgress(
              `${uf.toUpperCase()}: ${data.available} de ${data.total} resultados municipais recebidos`,
            );
          }
        }
      } catch {
        if (!stopped)
          setMunicipalProgress(
            'Consulta municipal indisponível; preservando resultados recebidos.',
          );
      } finally {
        index++;
        // One UF refreshes every 20 s; several visible UFs take turns every 6 s.
        if (!stopped) timer = setTimeout(poll, states.length > 1 ? 6000 : 20000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [
    selection.uf,
    selection.mode,
    selection.exterior,
    regions,
    ready,
    historyId,
    visibleMunicipalStates,
  ]);
  const results = useMemo(() => {
    const value = normalized(search);
    if (value.length < 2) return [];
    return regions
      .flatMap((r) => {
        const stateMatch = normalized(r.name + ' ' + r.code).includes(value);
        return [
          ...(stateMatch && r.code !== 'zz'
            ? [{ uf: r.code, town: '', name: r.name, group: 'ESTADOS' }]
            : []),
          ...r.municipalities
            .filter((m) => normalized(m.name).includes(value))
            .slice(0, 8)
            .map((m) => ({
              uf: r.code,
              town: m.code,
              name: m.name,
              group: r.code === 'zz' ? 'EXTERIOR' : 'MUNICÍPIOS',
            })),
        ];
      })
      .slice(0, 30);
  }, [search, regions]);
  // Moments already loaded come back at once while scrubbing the timeline.
  const frameCache = useRef(new Map<string, CockpitFrame>());
  const replay = async (id: string) => {
    if (!id) {
      setHistoryId('');
      setHistorical(null);
      return;
    }
    const cached = frameCache.current.get(id);
    if (cached) {
      setHistorical(cached);
      setHistoryId(id);
      return;
    }
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/election/president/cockpit?frame=${id}`);
      if (!response.ok) throw new Error();
      const next: Payload = await response.json();
      if (!next.frame) throw new Error();
      if (frameCache.current.size > 120) frameCache.current.clear();
      frameCache.current.set(id, next.frame);
      setHistorical(next.frame);
      setHistoryId(id);
    } catch {
      setNotice('Este momento não está mais disponível. A visualização atual foi preservada.');
    } finally {
      setHistoryLoading(false);
    }
  };
  const official = snapshot?.progress.totaledAt ?? snapshot?.progress.generatedAt;
  const age = now && official ? now - Date.parse(official) : 0;
  const stale = live.networkError || live.data.stale || age > 120000;
  const timeline = payload?.timeline ?? [];
  const selectedIndex = historyId
    ? Math.max(
        0,
        timeline.findIndex((t) => t.id === historyId),
      )
    : timeline.length - 1;
  const contextMetric = selection.town
    ? metrics.find((m) => m.uf === selection.uf && m.code === selection.town)
    : null;
  const contextState = map?.states.find((s) => s.uf === selection.uf);
  const local = detailQuery && !historyId ? detail.data.snapshot : null;
  const contextCandidates =
    local?.candidates.map((c) => ({
      id: c.id,
      number: c.number,
      name: c.ballotName,
      percentage: c.percentage,
      votes: c.votes,
      color: candidateColor(c),
    })) ??
    contextMetric?.candidates ??
    contextState?.candidates ??
    [];
  const currentCandidate = snapshot?.candidates.find((c) => c.number === selection.candidate);
  const contextTimestamp =
    local?.progress.totaledAt ??
    local?.progress.generatedAt ??
    contextMetric?.updatedAt ??
    contextState?.updatedAt;
  const liveBand = roundBand(snapshot ?? null);
  const race = raceModel(snapshot ?? null);
  const raceTag = `${snapshot?.turn ?? '2'}º turno · ${countedLabel(snapshot?.progress.percentageCounted ?? 0)} apurado`;
  // The chart follows the observed moments up to the one on screen (all of them when live).
  const observed = timeline.slice(0, Math.max(0, selectedIndex) + 1);
  const series: ChartSeries[] = race
    ? race.finalists.map((side) => ({
        side,
        points: chartMoments(observed).flatMap((moment) => {
          const candidate = moment.candidates.find((c) => c.id === side.id);
          return candidate ? [{ x: moment.counted, y: candidate.percentage }] : [];
        }),
      }))
    : [];
  const regionRows: RegionRowModel[] = map?.regions.length
    ? map.regions.map((region) => {
        const top = region.candidates[0];
        const candidate = top && snapshot?.candidates.find((c) => c.number === top.number);
        return {
          name: region.name,
          counted: region.countedPercentage,
          leader:
            candidate && top.percentage != null && top.votes > 0
              ? {
                  id: candidate.id,
                  number: candidate.number,
                  party: candidate.party,
                  name: candidate.ballotName,
                  color: candidateColor(candidate),
                  percentage: top.percentage,
                }
              : null,
        };
      })
    : REGION_NAMES.map((name) => ({ name, counted: null, leader: null }));
  const abroadSnapshot = historyId ? null : abroad.data.snapshot;
  const abroadRow = abroadSnapshot
    ? aggregateRegion('Exterior', [abroadSnapshot])
    : { name: 'Exterior', counted: null, leader: null };
  return (
    <div className="election-cockpit" ref={root}>
      <header className="cockpit-header">
        <Brand />
        <div className="office-context">
          Presidente <span>{roundLabel(snapshot?.turn)}</span>
        </div>
        <div className="cockpit-search">
          <label className="sr-only" htmlFor="territory-search">
            Buscar estado ou município
          </label>
          <input
            id="territory-search"
            placeholder="Buscar estado ou município"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchOpen(false);
              if (e.key === 'Enter' && results[0]) {
                const result = results[0];
                updateSelection({
                  uf: result.uf === 'zz' ? '' : result.uf,
                  town: result.town,
                  exterior: result.uf === 'zz',
                });
              }
            }}
          />
          {searchOpen && search.length >= 2 && (
            <div className="search-results" aria-label="Resultados da busca">
              {results.length ? (
                results.map((r) => (
                  <button
                    key={r.uf + r.town}
                    onClick={() => {
                      updateSelection({
                        uf: r.uf === 'zz' ? '' : r.uf,
                        town: r.town,
                        exterior: r.uf === 'zz',
                      });
                      setQuery('');
                    }}
                  >
                    <small>{r.group}</small>
                    {r.name}
                    <span>{r.uf.toUpperCase()}</span>
                  </button>
                ))
              ) : (
                <p>Nenhum território encontrado.</p>
              )}
            </div>
          )}
        </div>
        <OnlinePartiesBadge />
        <div className="cockpit-status">
          <b>{historyId ? 'VISUALIZANDO HISTÓRICO' : stale ? 'AGUARDANDO TSE' : 'AO VIVO'}</b>
          <span>
            Dado oficial: {time(official)} · {percent(snapshot?.progress.percentageCounted)}%
          </span>
        </div>
        <div className="header-actions">
          <button
            onClick={() => updateSelection({ exterior: !selection.exterior, uf: '', town: '' })}
          >
            Exterior
          </button>
          <WhatsAppShare />
          <button onClick={() => setInfo(!info)} aria-label="Informações e transparência">
            Info
          </button>
        </div>
      </header>
      {notice && (
        <div className="cockpit-notice" role="status" key={notice}>
          {notice}
          <button onClick={() => setNotice('')} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}
      {info && (
        <section className="cockpit-info">
          <b>Transparência · TSE</b>
          <span>Último dado oficial: {time(official)}</span>
          <span>Última consulta bem-sucedida: {time(live.telemetry.checkedAt)}</span>
          <span>Última tentativa: {time(live.telemetry.attemptedAt)}</span>
          <p>
            Revalidar cache não significa novos votos. Cartografia: IBGE, malha municipal
            simplificada; zonas não são bairros. Histórico observado, sem projeções.{' '}
            {payload?.temporary
              ? 'Armazenamento temporário por instância: o histórico pode reiniciar.'
              : 'Registro em arquivo local.'}
          </p>
          <a href="https://resultados.tse.jus.br/" target="_blank" rel="noreferrer">
            Fonte oficial
          </a>
          <button onClick={() => setInfo(false)}>Fechar</button>
        </section>
      )}
      {liveBand ? <RoundBand model={liveBand} label="Resultado ao vivo para Presidente" /> : band}
      <main className="cockpit-grid" id="conteudo" data-ready={ready}>
        {race ? (
          <RaceCards
            model={race}
            tag={raceTag}
            fact={{
              label: 'Seções apuradas',
              value: `${number(snapshot?.progress.countedSections)} de ${number(snapshot?.progress.totalSections)}`,
            }}
            series={series}
            emptyChart="A curva aparece após duas observações reais da apuração. Nenhum dado é inventado."
            allCandidates={snapshot?.turn === '1'}
            note={
              stale && !historyId && snapshot?.status !== 'finished'
                ? `Último dado válido preservado às ${time(official)}.`
                : undefined
            }
          />
        ) : (
          <RaceWaiting tag={raceTag} text="Aguardando os primeiros votos válidos do TSE." />
        )}
        <section
          className="map-panel"
          data-local={!!selection.town}
          aria-labelledby="central-map-title"
        >
          <div className="map-panel-top">
            <nav aria-label="Navegação geográfica">
              <button onClick={() => updateSelection({ uf: '', town: '', exterior: false })}>
                Brasil
              </button>
              {selection.uf && (
                <>
                  <span>›</span>
                  <button onClick={() => select(selection.uf)}>
                    {selectedRegion ? editorialName(selectedRegion.name) : null}
                  </button>
                </>
              )}
              {selectedTown && (
                <>
                  <span>›</span>
                  <button onClick={() => select(selection.uf, selection.town)}>
                    {editorialName(selectedTown.name)}
                  </button>
                </>
              )}
            </nav>
            <h2 id="central-map-title">Mapa da apuração</h2>
          </div>
          <div className="map-mode-switcher" aria-label="Modos do mapa">
            {(selection.town
              ? [
                  ['states', 'Cor'],
                  ['margin', 'Vantagem'],
                  ['counted', 'Apurado'],
                ]
              : [
                  ['states', 'Estados'],
                  ['municipalities', 'Municípios'],
                  ['margin', 'Vantagem'],
                  ['counted', 'Apurado'],
                ]
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={selection.mode === value}
                onClick={() => updateSelection({ mode: value as MapMode })}
              >
                {label}
              </button>
            ))}
            <label>
              <span className="sr-only">Mapa de candidato</span>
              <select
                aria-label="Mapa de candidato"
                value={selection.mode === 'candidate' ? selection.candidate : ''}
                onChange={(e) => updateSelection({ mode: 'candidate', candidate: e.target.value })}
              >
                <option value="" disabled>
                  Candidato
                </option>
                {snapshot?.candidates.map((c) => (
                  <option key={c.id} value={c.number}>
                    {c.ballotName} · {c.number}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selection.exterior ? (
            <section className="exterior-map-placeholder">
              <span>EXTERIOR</span>
              <h2>Votos fora do Brasil</h2>
              <p>Os resultados do exterior ficam separados das cinco regiões brasileiras.</p>
              <label>
                País ou localidade
                <select
                  aria-label="País ou localidade"
                  value={selection.town}
                  onChange={(e) => updateSelection({ town: e.target.value })}
                >
                  <option value="">Todas as localidades</option>
                  {regions
                    .find((r) => r.code === 'zz')
                    ?.municipalities.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <button onClick={() => updateSelection({ exterior: false, town: '' })}>
                Voltar ao Brasil
              </button>
            </section>
          ) : (
            <CockpitMap
              candidateRegistry={snapshot?.candidates ?? []}
              snapshot={map}
              metrics={metrics}
              uf={selection.uf}
              town={selection.town}
              mode={selection.mode}
              candidate={selection.candidate}
              onSelect={select}
              selectedName={selectedName}
              historical={!!historyId}
              onVisibleStates={onVisibleStates}
              zones={zoneData.zones}
              zone={selection.zone}
              hoveredZone={hoveredZone}
              onZoneHover={setHoveredZone}
              onZoneSelect={(zone) => updateSelection({ zone })}
            />
          )}
          <div className="map-legend">
            {selection.mode === 'counted' ? (
              <>
                <span>Totalização</span>
                {['<25%', '25–50%', '50–75%', '75–100%', '100%'].map((t, i) => (
                  <span key={t}>
                    <i
                      style={{
                        background: ['#263641', '#38586a', '#508098', '#7fa7b7', '#c2dedc'][i],
                      }}
                    />
                    {t}
                  </span>
                ))}
              </>
            ) : selection.mode === 'margin' ? (
              <span>Cor: líder · bolhas: vantagem em votos</span>
            ) : selection.mode === 'candidate' ? (
              <span>{currentCandidate?.party ?? 'Candidato'} · intensidade: percentual</span>
            ) : (
              <>
                {map?.legend
                  .filter((c) => c.stateCount > 0)
                  .slice(0, 2)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => updateSelection({ mode: 'candidate', candidate: c.number })}
                    >
                      <i style={{ background: c.color }} />
                      {snapshot?.candidates.find((x) => x.number === c.number)?.party ??
                        c.name}{' '}
                      <b>
                        {selection.mode === 'municipalities' || selection.uf
                          ? ''
                          : `${c.stateCount} UFs`}
                      </b>
                    </button>
                  ))}
                <details>
                  <summary>+ legenda</summary>
                  {map?.legend.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => updateSelection({ mode: 'candidate', candidate: c.number })}
                    >
                      <i style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))}
                  <span>
                    <i style={{ background: '#252d35' }} />
                    Sem resultado recebido
                  </span>
                </details>
              </>
            )}
          </div>
          <details className="territory-navigation">
            <summary aria-label="Abrir navegação territorial">Navegar por território</summary>
            <div className="territory-alternative">
              <label>
                Estado
                <select
                  aria-label="Selecionar estado no mapa"
                  value={selection.uf}
                  onChange={(e) => select(e.target.value)}
                >
                  <option value="">Brasil</option>
                  {regions
                    .filter((r) => r.code !== 'zz')
                    .map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name} · {r.code.toUpperCase()}
                      </option>
                    ))}
                </select>
              </label>
              {selection.uf && (
                <label>
                  Município
                  <select
                    aria-label="Selecionar município no mapa"
                    value={selection.town}
                    onChange={(e) => select(selection.uf, e.target.value)}
                  >
                    <option value="">Todos os municípios</option>
                    {selectedRegion?.municipalities.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span>{municipalProgress}</span>
            </div>
          </details>
          {historyId && (
            <p className="historical-map-note">
              Mapa conhecido em {time(historical?.observedAt)}. Áreas sem observação nesse momento
              permanecem neutras.
            </p>
          )}
          <section className="cockpit-timeline" aria-label="Reprodução histórica">
            <div>
              <b>{historyId ? 'VISUALIZANDO HISTÓRICO' : 'AO VIVO'}</b>
              {historyId ? <span>{time(historical?.observedAt)}</span> : <BrasiliaClock />}
            </div>
            <CountTimeline
              moments={timeline}
              selectedId={historyId}
              loading={historyLoading}
              onSelect={(id) => void replay(id)}
            />
            <button onClick={() => void replay('')} disabled={!historyId}>
              Voltar ao vivo
            </button>
            <small>
              {payload?.temporary ? 'Histórico temporário por instância' : 'Histórico local'} ·
              últimos 90 momentos
            </small>
          </section>
        </section>
        <aside
          className={
            selection.uf || selection.exterior ? 'context-panel' : 'context-panel has-region-board'
          }
          aria-label="Regiões e contexto selecionado"
        >
          {selection.uf || selection.exterior ? (
            <section>
              <button
                className="back-button"
                onClick={() =>
                  selection.town && !selection.exterior
                    ? select(selection.uf)
                    : updateSelection({ uf: '', town: '', exterior: false })
                }
              >
                Voltar para{' '}
                {selection.town && !selection.exterior ? selectedRegion?.name : 'Brasil'}
              </button>
              <span className="eyebrow">
                {selection.exterior ? 'EXTERIOR' : selection.town ? 'MUNICÍPIO' : 'ESTADO'}
              </span>
              <h2>{editorialName(selectedName)}</h2>
              {selection.town && (
                <p className="municipal-summary">
                  {selection.uf.toUpperCase()} · {number(local?.progress.eligibleVoters)} eleitores
                  aptos
                  <br />
                  Presidente no município · {number(local?.progress.countedSections)} de{' '}
                  {number(local?.progress.totalSections)} seções
                </p>
              )}
              <strong className="context-counted">
                {percent(
                  local?.progress.percentageCounted ??
                    contextMetric?.counted ??
                    contextState?.countedPercentage,
                )}
                %
              </strong>
              <small>totalizado · dado oficial {time(contextTimestamp)}</small>
              {contextCandidates.map((c) => (
                <div className="context-candidate" key={c.id}>
                  <span>
                    <i style={{ background: c.color }} />
                    {editorialName(c.name)}
                  </span>
                  <b>{percent(c.percentage)}%</b>
                  <small>{number(c.votes)} votos</small>
                  <div className="municipal-candidate-bar">
                    <i style={{ width: c.percentage + '%', background: c.color }} />
                  </div>
                </div>
              ))}
              <dl>
                <dt>Votos válidos</dt>
                <dd>
                  {number(
                    local?.progress.validVotes ??
                      contextMetric?.validVotes ??
                      contextState?.validVotes,
                  )}
                </dd>
                <dt>Seções</dt>
                <dd>
                  {number(local?.progress.countedSections)} /{' '}
                  {number(local?.progress.totalSections)}
                </dd>
                <dt>Eleitores aptos</dt>
                <dd>{number(local?.progress.eligibleVoters ?? contextState?.eligibleVoters)}</dd>
              </dl>
              {selectedTown && (
                <section className="zones-list">
                  <h3>Zonas eleitorais</h3>
                  <p>
                    {historyId
                      ? 'Resultados por zona não registrados neste momento histórico.'
                      : 'Resultados oficiais por zona · limites geográficos não disponíveis.'}
                  </p>
                  {zoneData.zones.map((z) => (
                    <button
                      className={'zone-row' + (hoveredZone === z.number ? ' is-highlighted' : '')}
                      key={z.number}
                      data-zone={z.number}
                      aria-pressed={selection.zone === z.number}
                      onPointerEnter={() => setHoveredZone(z.number)}
                      onPointerLeave={() => setHoveredZone('')}
                      onFocus={() => setHoveredZone(z.number)}
                      onBlur={() => setHoveredZone('')}
                      onClick={() => updateSelection({ zone: z.number })}
                    >
                      <b>{zoneLabel(selection.uf, selection.town, z.number)}</b>
                      <small>
                        {zoneNeighborhood(selection.uf, selection.town, z.number) &&
                          `${Number(z.number)}ª zona · `}
                        {z.progress
                          ? number(z.progress.eligibleVoters) + ' eleitores aptos'
                          : 'Aguardando resultado'}
                      </small>
                      {z.candidates[0] && (
                        <>
                          <span>
                            <i style={{ background: candidateColor(z.candidates[0]) }} />
                            {editorialName(z.candidates[0].ballotName)}
                          </span>
                          <strong>{percent(z.candidates[0].percentage)}%</strong>
                          <div className="zone-mini-bar">
                            {z.candidates.slice(0, 2).map((c) => (
                              <i
                                key={c.id}
                                style={{ width: c.percentage + '%', background: candidateColor(c) }}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </button>
                  ))}
                  {zoneData.zones.some((z) =>
                    zoneNeighborhood(selection.uf, selection.town, z.number),
                  ) && (
                    <p>
                      Bairros de referência; cada zona pode abranger outros bairros.{' '}
                      <a href={zoneNeighborhoodSource} target="_blank" rel="noreferrer">
                        Locais de votação · TSE (2026)
                      </a>
                    </p>
                  )}
                  {!zoneData.zones.length && <p>Catálogo de zonas indisponível.</p>}
                  {zoneData.unavailable && (
                    <p>Consulta indisponível. Últimos resultados recebidos preservados.</p>
                  )}
                </section>
              )}
              {!selection.town && !selection.exterior && (
                <>
                  <h3>Municípios · {selectedRegion?.municipalities.length}</h3>
                  <div className="context-town-list">
                    {selectedRegion?.municipalities.map((m) => (
                      <button key={m.code} onClick={() => select(selection.uf, m.code)}>
                        {m.name}
                        <span>
                          {percent(
                            metrics.find((x) => x.uf === selection.uf && x.code === m.code)
                              ?.counted,
                          )}
                          %
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {historyId && selection.exterior && (
                <p>
                  Exterior não registrado neste momento. Nenhum dado atual será usado na reprodução.
                </p>
              )}
            </section>
          ) : selection.mode === 'candidate' && currentCandidate ? (
            <section className="candidate-context">
              <button onClick={() => updateSelection({ mode: 'states', candidate: '' })}>
                Voltar às regiões
              </button>
              <Portrait candidate={currentCandidate} />
              <h2>{editorialName(currentCandidate.ballotName)}</h2>
              <p>
                {currentCandidate.party} · {currentCandidate.number}
              </p>
              <strong>{percent(currentCandidate.percentage)}%</strong>
              <p>{number(currentCandidate.votes)} votos no Brasil</p>
              <h3>Maiores percentuais por UF</h3>
              {[...(map?.states ?? [])]
                .filter((s) => s.candidates?.some((c) => c.number === selection.candidate))
                .sort(
                  (a, b) =>
                    b.candidates!.find((c) => c.number === selection.candidate)!.percentage -
                    a.candidates!.find((c) => c.number === selection.candidate)!.percentage,
                )
                .slice(0, 5)
                .map((s) => (
                  <button key={s.uf} onClick={() => select(s.uf)}>
                    {s.uf.toUpperCase()} · {s.name}
                    <b>
                      {percent(
                        s.candidates?.find((c) => c.number === selection.candidate)?.percentage,
                      )}
                      %
                    </b>
                  </button>
                ))}
              <h3>Menores percentuais por UF</h3>
              {[...(map?.states ?? [])]
                .filter((s) => s.candidates?.some((c) => c.number === selection.candidate))
                .sort(
                  (a, b) =>
                    a.candidates!.find((c) => c.number === selection.candidate)!.percentage -
                    b.candidates!.find((c) => c.number === selection.candidate)!.percentage,
                )
                .slice(0, 3)
                .map((s) => (
                  <button key={s.uf} onClick={() => select(s.uf)}>
                    {s.uf.toUpperCase()} · {s.name}
                    <b>
                      {percent(
                        s.candidates?.find((c) => c.number === selection.candidate)?.percentage,
                      )}
                      %
                    </b>
                  </button>
                ))}
            </section>
          ) : (
            <>
              <RegionBoard
                regions={regionRows}
                exterior={abroadRow}
                onExterior={() => updateSelection({ exterior: true, uf: '', town: '' })}
              />
              <GovernorBoard />
            </>
          )}
          <section className="update-feed">
            <h2>Últimas atualizações</h2>
            {timeline
              .slice(-5)
              .reverse()
              .map((t, i) => {
                const prev = timeline[timeline.length - 2 - i];
                return (
                  <article key={t.id}>
                    <time>{time(t.observedAt)}</time>
                    <b>
                      {t.sections - (prev?.sections ?? t.sections) > 0
                        ? `+${number(t.sections - prev.sections)} seções nacionais`
                        : 'Apuração atualizada'}
                    </b>
                    <span className="feed-scores">
                      {t.candidates.slice(0, 2).map((c) => (
                        <span key={c.id}>
                          <i style={{ background: c.color }} />
                          {editorialName(c.name)}
                          <strong>{percent(c.percentage)}%</strong>
                        </span>
                      ))}
                    </span>
                    <span>Brasil · {percent(t.counted)}% totalizado</span>
                    <small>Dado oficial: {time(t.officialAt)}</small>
                  </article>
                );
              })}
            {!timeline.length && <p>Aguardando a primeira atualização.</p>}
          </section>
        </aside>
      </main>

      <footer className="cockpit-footer">
        Resultados Brasil · painel independente, sem vínculo institucional com o TSE · dados
        oficiais e cartografia IBGE · <a href="/privacidade">Política de Privacidade</a>
      </footer>
    </div>
  );
}
