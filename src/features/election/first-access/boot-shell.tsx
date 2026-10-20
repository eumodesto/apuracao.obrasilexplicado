'use client';
import { useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import geometry from '../map/geometry.json';
import { NATIONAL_VIEW } from '../cockpit/map-navigation';
import { time, percent, number, roundLabel } from '@/lib/format';
import Image from 'next/image';
import type { ElectionResponse } from '@/lib/tse/types';
import '../cockpit/cockpit.css';
import '../cockpit/editorial.css';
import './first-access.css';

export function NeutralMap({ view = NATIONAL_VIEW, uf = '' }: { view?: number[]; uf?: string }) {
  return (
    <svg
      className="boot-neutral-map"
      viewBox={view.join(' ')}
      aria-label="Mapa do Brasil aguardando resultado oficial"
    >
      {geometry.states
        .filter((state) => !uf || state.uf === uf)
        .map((state) => (
          <path key={state.uf} d={state.path} vectorEffect="non-scaling-stroke" />
        ))}
    </svg>
  );
}
export function PendingRegions() {
  return (
    <div className="boot-region-reserve" aria-label="Regiões aguardando dados">
      {['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'].map((name) => (
        <div key={name} className="boot-region-row">
          <span>
            {name}
            <small>— totalizado</small>
          </span>
          <b>—</b>
          <i />
        </div>
      ))}
    </div>
  );
}
export function BootShell({
  waiting = false,
  initial,
  fallback = false,
}: {
  waiting?: boolean;
  initial?: ElectionResponse;
  fallback?: boolean;
}) {
  const snapshot = initial?.snapshot,
    top = [...(snapshot?.candidates ?? [])].sort((a, b) => b.votes - a.votes).slice(0, 2);
  const [clock, setClock] = useState('—'),
    [mode, setMode] = useState('Estados'),
    [info, setInfo] = useState(false);
  useEffect(() => {
    performance.mark('election-shell-interactive');
    const update = () => setClock(time(new Date().toISOString()));
    const start = setTimeout(update, 0),
      timer = setInterval(update, 1000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, []);
  const exterior = () => {
    const url = new URL(location.href);
    url.searchParams.set('scope', 'exterior');
    location.href = url.href;
  };
  return (
    <div className="election-cockpit boot-shell" data-first-access="pending">
      <header className="cockpit-header">
        <Brand />
        <div className="office-context">
          Presidente <span>{roundLabel(snapshot?.turn)}</span>
        </div>
        <div className="cockpit-search">
          <label className="sr-only" htmlFor="boot-search">
            Buscar estado ou município
          </label>
          <input
            id="boot-search"
            placeholder="Buscar estado ou município"
            onChange={(e) => sessionStorage.setItem('first-access-search', e.target.value)}
          />
        </div>
        <div className="cockpit-status" role="status">
          <b>{waiting ? 'AGUARDANDO TSE' : 'SINCRONIZANDO'}</b>
          <span>
            {snapshot
              ? `Dado oficial: ${time(snapshot.progress.totaledAt ?? snapshot.progress.generatedAt)} · ${percent(snapshot.progress.percentageCounted)}%`
              : waiting
                ? 'Aguardando primeiro resultado oficial disponível.'
                : 'Buscando último resultado oficial'}
          </span>
        </div>
        <div className="header-actions">
          <button onClick={exterior}>Exterior</button>
          <button
            aria-label="Compartilhar contexto"
            onClick={() => navigator.clipboard?.writeText(location.href)}
          >
            Compartilhar
          </button>
          <button
            aria-label="Alternar tela cheia"
            onClick={() => document.documentElement.requestFullscreen?.()}
          >
            Tela cheia
          </button>
          <button aria-label="Informações e transparência" onClick={() => setInfo(!info)}>
            Info
          </button>
        </div>
      </header>
      {info && (
        <section className="cockpit-info">
          <b>Transparência · TSE</b>
          <p>
            Valores serão exibidos quando houver um resultado oficial. Áreas sem dados permanecem
            neutras.
          </p>
          <button onClick={() => setInfo(false)}>Fechar</button>
        </section>
      )}
      <main className="cockpit-grid" id={fallback ? 'boot-content' : 'conteudo'}>
        <section className="race-panel">
          <div className="panel-heading">
            <h1>Presidente · Brasil</h1>
            <small>{snapshot ? 'ÚLTIMO RESULTADO OFICIAL' : 'AGUARDANDO RESULTADO OFICIAL'}</small>
          </div>
          <div className="race-progress">
            <strong>
              {percent(snapshot?.progress.percentageCounted)}
              {snapshot && <small>%</small>}
            </strong>
            <span>
              DAS SEÇÕES TOTALIZADAS
              <br />
              {number(snapshot?.progress.countedSections)} de{' '}
              {number(snapshot?.progress.totalSections)}
            </span>
          </div>
          <div className="cockpit-top-two">
            {top.length
              ? top.map((candidate) => (
                  <div className="cockpit-candidate" key={candidate.id}>
                    <strong>{candidate.ballotName}</strong>
                    <Image
                      unoptimized
                      preload
                      src={`/api/election/photo/${candidate.id}`}
                      alt={candidate.ballotName}
                      width={52}
                      height={58}
                    />
                    <small>
                      {candidate.party} · {candidate.number}
                    </small>
                    <b>
                      {percent(candidate.percentage)}
                      <small>%</small>
                    </b>
                    <span>{number(candidate.votes)}</span>
                  </div>
                ))
              : [1, 2].map((slot) => (
                  <div className="cockpit-candidate" key={slot}>
                    <strong>Candidatura —</strong>
                    <div className="portrait-fallback boot-portrait" aria-hidden="true" />
                    <small>—</small>
                    <b>—</b>
                    <span>— votos</span>
                  </div>
                ))}
          </div>
          <div className="comparison-bar" />
          <div className="race-gap">
            <span>Diferença</span>
            <b>—</b>
          </div>
          <div className="cockpit-majority">
            <b>Aguardando votos válidos</b>
          </div>
          <div className="other-candidates">
            <p>Demais candidaturas · —</p>
          </div>
          <section className="compact-chart">
            <h2>Ao longo da apuração</h2>
            <div className="boot-chart">Aguardando observações oficiais</div>
            <p>Observações reais · votos válidos · sem projeção</p>
          </section>
        </section>
        <section className="map-panel" aria-label="Mapa da apuração">
          <div className="cockpit-map">
            <NeutralMap />
          </div>
          <div className="map-panel-top">
            <nav>Brasil</nav>
          </div>
          <div className="map-mode-switcher" aria-label="Modos do mapa">
            {['Estados', 'Municípios', 'Vantagem', 'Apurado'].map((label) => (
              <button
                aria-pressed={mode === label}
                key={label}
                onClick={() => {
                  setMode(label);
                  const url = new URL(location.href);
                  const views: Record<string, string> = {
                    Estados: 'states',
                    Municípios: 'municipalities',
                    Vantagem: 'margin',
                    Apurado: 'counted',
                  };
                  url.searchParams.set('view', views[label]);
                  history.replaceState(null, '', url);
                }}
              >
                {label}
              </button>
            ))}
            <select aria-label="Mapa de candidato" defaultValue="">
              <option value="">Candidato</option>
            </select>
          </div>
          <span className="map-attribution">
            IBGE · Áreas neutras até receber resultado oficial
          </span>
          <section className="cockpit-timeline">
            <div>
              <b>HORÁRIO DE BRASÍLIA</b>
              <span aria-label="Horário atual de Brasília">{clock}</span>
            </div>
            <span className="boot-timeline-line" />
          </section>
        </section>
        <aside className="context-panel">
          <section className="region-sidebar">
            <h2>Por região</h2>
            <PendingRegions />
            <button className="exterior-row" onClick={exterior}>
              Exterior <span>Consultar</span>
            </button>
          </section>
          <section className="update-feed">
            <h2>Últimas atualizações</h2>
            <p role="status">
              {waiting
                ? 'Aguardando primeiro resultado oficial disponível.'
                : 'Buscando último resultado oficial'}
            </p>
          </section>
        </aside>
      </main>
      <footer className="cockpit-footer">
        Resultados Brasil · painel independente, sem vínculo institucional com o TSE · dados
        oficiais e cartografia IBGE
      </footer>
    </div>
  );
}
