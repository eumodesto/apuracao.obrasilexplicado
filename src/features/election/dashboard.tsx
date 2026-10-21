'use client';
import { useCallback, useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { dateTime, number, percent, time } from '@/lib/format';
import type { ElectionResponse, Geography } from '@/lib/tse/types';
import type { ElectionMapSnapshot } from '@/lib/tse/map-types';
import { ElectionMap } from './map/election-map';
import { useElection } from './use-election';
import { CandidateList } from './candidate-list';
import { StateResults } from './state-results';
import { HistoryChart } from './history-chart';
import './editorial.css';

export function Dashboard({
  initial,
  regions: initialRegions,
}: {
  initial: ElectionResponse;
  regions: Geography[];
}) {
  const national = useElection('scope=br', initial);
  const [regions, setRegions] = useState(initialRegions);
  const [scope, setScope] = useState('br');
  const [state, setState] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [now, setNow] = useState<number | null>(null);
  const [mapSnapshot, setMapSnapshot] = useState<ElectionMapSnapshot | null>(null);
  const detailQuery =
    scope === 'br' && !state
      ? null
      : new URLSearchParams({
          scope,
          ...(state ? { state } : {}),
          ...(municipality ? { municipality } : {}),
        }).toString();
  const detail = useElection(detailQuery);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (regions.length) return;
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      try {
        const r = await fetch('/api/election/geography', { signal: controller.signal });
        if (r.ok) {
          const next = await r.json();
          if (!cancelled && next.regions?.length) setRegions(next.regions);
        }
      } catch {}
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [regions.length]);
  const change = useCallback((nextScope: string, nextState: string, nextTown: string) => {
    setScope(nextScope);
    setState(nextState);
    setMunicipality(nextTown);
  }, []);
  const selectMapState = useCallback((uf: string) => change('br', uf, ''), [change]);
  const selectTableState = useCallback(
    (uf: string) => {
      selectMapState(uf);
      requestAnimationFrame(() =>
        document.getElementById('resultados')?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        }),
      );
    },
    [selectMapState],
  );
  const receiveMap = useCallback((next: ElectionMapSnapshot) => setMapSnapshot(next), []);
  const data = national.data;
  const snapshot = data.snapshot;
  const progress = snapshot?.progress;
  const timestamp = progress?.totaledAt ?? progress?.generatedAt;
  const age = timestamp && now ? Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60000)) : 0;
  const stale =
    data.stale ||
    national.networkError ||
    (snapshot?.status === 'counting' && age * 60000 >= (data.staleAfterMs ?? 120000));
  const statusLabel = national.loading
    ? 'ATUALIZANDO'
    : stale
      ? `ÚLTIMO DADO RECEBIDO HÁ ${age} MIN`
      : snapshot?.status === 'finished'
        ? 'TOTALIZAÇÃO CONCLUÍDA'
        : snapshot?.status === 'waiting'
          ? 'AGUARDANDO APURAÇÃO'
          : 'DADOS ATUALIZADOS';
  const analysis = data.analysis;
  const lead = analysis?.candidates[0];
  const distance = lead ? lead.percentage - 50 : null;
  const selectedRegion = regions.find((r) => r.code === (scope === 'exterior' ? 'zz' : state));
  const selectedTown = selectedRegion?.municipalities.find((m) => m.code === municipality);
  const scopeName = selectedTown
    ? `${selectedTown.name} / ${selectedRegion?.code.toUpperCase()}`
    : (selectedRegion?.name ?? (scope === 'exterior' ? 'Exterior' : 'Brasil'));
  const selected = detail.data.snapshot;
  const detailProgress = selected?.progress;
  return (
    <>
      <header className="header compact-header">
        <div className="header-inner">
          <Brand />
          <div className="header-office">
            PRESIDENTE DA REPÚBLICA<span>1º TURNO · 04 OUTUBRO 2026</span>
          </div>
          <div className="connection">
            <span className={`status ${!stale && snapshot?.status === 'counting' ? 'live' : ''}`}>
              <i />
              {statusLabel}
            </span>
            <span>
              Última atualização: <b>{time(timestamp)}</b>
            </span>
          </div>
        </div>
      </header>
      <main id="conteudo" className="container presidential-page">
        <section className="national-results" aria-labelledby="national-title">
          <div className="national-heading">
            <div>
              <p className="eyebrow">BRASIL · 1º TURNO</p>
              <h1 id="national-title">Presidente da República</h1>
              <span className="national-clock">Fonte: TSE · Dado oficial de {time(timestamp)}</span>
            </div>
            <div className="national-total">
              <div className="big-number">
                {percent(progress?.percentageCounted)}
                {progress && <span>%</span>}
              </div>
              <p>DAS SEÇÕES TOTALIZADAS</p>
              <span>
                {number(progress?.countedSections)} de {number(progress?.totalSections)} seções
              </span>
            </div>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Seções totalizadas"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress?.percentageCounted}
          >
            <span style={{ width: `${progress?.percentageCounted ?? 0}%` }} />
          </div>
          <h2 className="sr-only" id={!detailQuery ? 'results-title' : undefined}>
            Presidente — Brasil
          </h2>
          {national.loading && (
            <p className="national-loading" role="status">
              Consultando dados nacionais…
            </p>
          )}
          {snapshot?.status === 'waiting' && (
            <p className="waiting-strip">Aguardando início da apuração · Sem votos totalizados</p>
          )}
          {snapshot ? (
            <CandidateList candidates={snapshot.candidates.slice(0, 2)} emphasis />
          ) : (
            <div className="empty-state">
              <h2>Aguardando conexão com o TSE</h2>
              <p>
                Os resultados oficiais aparecerão assim que um arquivo válido estiver disponível.
              </p>
            </div>
          )}
          <div className="majority-indicator" aria-label="Leitura matemática da maioria absoluta">
            <div>
              <p className="eyebrow">MAIORIA ABSOLUTA · VOTOS VÁLIDOS</p>
              <p>Mais de 50% dos votos válidos são necessários para vitória no primeiro turno.</p>
            </div>
            <div className="majority-reading">
              {lead && distance !== null ? (
                <>
                  <b>{lead.name}</b>
                  <strong>
                    {percent(Math.abs(distance))} p.p.{' '}
                    {distance > 0 ? 'acima' : distance < 0 ? 'abaixo' : 'na linha'}{' '}
                    {distance !== 0 ? 'da maioria absoluta' : 'dos 50%'}
                  </strong>
                  <small>{percent(lead.percentage)}% dos votos válidos observados</small>
                </>
              ) : (
                <strong>Aguardando votos válidos consistentes</strong>
              )}
            </div>
            {lead && (
              <div className="majority-track" aria-hidden="true">
                <span style={{ width: `${lead.percentage}%`, background: lead.color }} />
                <i />
                <small>50%</small>
              </div>
            )}
            <p className="majority-disclaimer">
              Leitura do resultado atual, sem projeção ou declaração de vitória. Não substitui a
              situação oficial da candidatura.
            </p>
          </div>
          {snapshot && (
            <>
              <p className="remaining-label">Demais candidaturas</p>
              <CandidateList candidates={snapshot.candidates.slice(2)} />
              <p className="method-note">
                Todos os candidatos. Ordem por votos computados e sequência oficial em empate.
                Percentuais das candidaturas publicados pelo TSE; a leitura dos 50% usa somente
                votos válidos consistentes. Brasil inclui o exterior.
              </p>
            </>
          )}
          {(stale || data.issue) && (
            <div className="notice" role="status">
              <strong>
                {data.issue ?? 'A fonte oficial não publicou uma atualização recente.'}
              </strong>
              <span>
                {snapshot
                  ? 'Exibindo a última atualização recebida. Último resultado oficial válido preservado.'
                  : 'Tentaremos novamente automaticamente.'}
                {age > 0 ? ` Última atualização recebida há ${age} min.` : ''}
              </span>
            </div>
          )}
        </section>
        <ElectionMap
          onSelectState={selectMapState}
          selectedState={scope === 'br' ? state : ''}
          onSnapshot={receiveMap}
        />
        <StateResults snapshot={mapSnapshot} onSelect={selectTableState} />
        <HistoryChart />
        <section
          className="local-results editorial-section"
          id="resultados"
          aria-labelledby="detail-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">EXTERIOR · ESTADOS · MUNICÍPIOS</p>
              <h2 id="detail-title">Consulte uma localidade</h2>
            </div>
            <p>O exterior não integra as cinco regiões brasileiras.</p>
          </div>
          <nav className="filters" aria-label="Abrangência dos resultados">
            <div className="scope-tabs">
              <button aria-pressed={scope === 'br'} onClick={() => change('br', '', '')}>
                Brasil
              </button>
              <button
                aria-pressed={scope === 'exterior'}
                onClick={() => change('exterior', '', '')}
              >
                Exterior
              </button>
            </div>
            <div className="selects" id="geography-selects" data-mobile-open="true">
              {scope === 'br' && (
                <label>
                  <span>Estado</span>
                  <select
                    aria-label="Estado"
                    value={state}
                    onChange={(e) => change(scope, e.target.value, '')}
                  >
                    <option value="">Todos os estados</option>
                    {regions
                      .filter((r) => r.code !== 'zz')
                      .map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                <span>{scope === 'exterior' ? 'Localidade' : 'Município'}</span>
                <select
                  aria-label={scope === 'exterior' ? 'Localidade' : 'Município'}
                  disabled={!selectedRegion}
                  value={municipality}
                  onChange={(e) => change(scope, state, e.target.value)}
                >
                  <option value="">
                    {scope === 'exterior'
                      ? 'Todas as localidades'
                      : state
                        ? 'Todos os municípios'
                        : 'Selecione um estado'}
                  </option>
                  {selectedRegion?.municipalities.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </nav>
          {detailQuery ? (
            <div className="detail-result" aria-busy={detail.loading}>
              <h3 id="results-title">Presidente — {scopeName}</h3>
              {detail.loading && (
                <p className="loading-message" role="status">
                  Consultando a abrangência selecionada…
                </p>
              )}
              {detail.networkError || detail.data.issue ? (
                <p className="detail-warning" role="status">
                  Consulta temporariamente indisponível. Último dado válido desta localidade
                  preservado quando disponível.
                </p>
              ) : null}
              {selected ? (
                <>
                  <p>
                    {percent(detailProgress?.percentageCounted)}% totalizado · Fonte: TSE ·{' '}
                    {dateTime(detailProgress?.totaledAt ?? detailProgress?.generatedAt)}
                  </p>
                  <CandidateList candidates={selected.candidates} />
                  <dl className="detail-statistics">
                    {[
                      ['Eleitores aptos', detailProgress?.eligibleVoters],
                      ['Votos válidos', detailProgress?.validVotes],
                      ['Comparecimento', detailProgress?.turnout],
                      ['Abstenções', detailProgress?.abstentions],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{number(value as number | null | undefined)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                !detail.loading && <p>Aguardando um arquivo oficial válido para esta localidade.</p>
              )}
            </div>
          ) : (
            <p className="local-help">
              Selecione um estado para consultar seus municípios, ou escolha Exterior. O resultado
              nacional continua disponível no topo.
            </p>
          )}
        </section>
        <section className="transparency editorial-section" aria-labelledby="transparency-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">FONTE · HORÁRIOS · DISPONIBILIDADE</p>
              <h2 id="transparency-title">Transparência dos dados</h2>
            </div>
            <a
              className="text-link"
              href="https://resultados.tse.jus.br/"
              target="_blank"
              rel="noreferrer"
            >
              Consultar fonte oficial
            </a>
          </div>
          <dl>
            <div>
              <dt>Fonte eleitoral</dt>
              <dd>Tribunal Superior Eleitoral — TSE</dd>
            </div>
            <div>
              <dt>Último dado oficial</dt>
              <dd>{dateTime(timestamp)}</dd>
            </div>
            <div>
              <dt>Última tentativa de atualização</dt>
              <dd>{time(national.telemetry.attemptedAt)}</dd>
            </div>
            <div>
              <dt>Última consulta bem-sucedida</dt>
              <dd>{time(national.telemetry.checkedAt)}</dd>
            </div>
            <div>
              <dt>Status nacional</dt>
              <dd>
                {stale
                  ? 'Último dado válido preservado'
                  : snapshot?.status === 'waiting'
                    ? 'Aguardando nova publicação'
                    : 'Atualizado · aguardando nova publicação'}
              </dd>
            </div>
          </dl>
          <dl className="detail-statistics">
            {[
              ['Eleitores aptos no Brasil e exterior', progress?.eligibleVoters],
              ['Votos válidos nacionais', progress?.validVotes],
              ['Comparecimento nacional', progress?.turnout],
              ['Abstenções nacionais', progress?.abstentions],
              ['Votos brancos nacionais', progress?.blankVotes],
              ['Votos nulos nacionais', progress?.nullVotes],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{number(value as number | null | undefined)}</dd>
              </div>
            ))}
          </dl>
          <p>
            O horário oficial pertence ao arquivo eleitoral. Revalidar o cache ou receber HTTP 304
            não significa que novos votos foram publicados. Estados e regiões conservam seus
            próprios horários.
          </p>
          {stale && (
            <p>
              A fonte oficial não publicou uma atualização recente ou a consulta está indisponível.
              Exibindo o último resultado oficial recebido.
            </p>
          )}
        </section>
      </main>
      <footer>
        <div className="footer-inner">
          <Brand />
          <p>
            Dados eleitorais provenientes do Tribunal Superior Eleitoral (TSE).
            <br />
            Resultados Brasil é um painel independente de visualização e não possui vínculo
            institucional com o Tribunal Superior Eleitoral.
          </p>
          <p>
            Horário oficial de Brasília
            <br />
            <b>{time(timestamp)}</b>
          </p>
        </div>
      </footer>
    </>
  );
}
