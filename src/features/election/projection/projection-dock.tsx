'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { BADGE_SLOT_ID, useAccess } from '@/features/access/access-gate';
import { useNational } from '@/features/election/live-summary';
import { percent, number } from '@/lib/format';
import {
  claimPanel,
  openFloatingPanel,
  releasePanel,
  subscribePanels,
} from './floating-panels';
import { projectionModel, type ProjectionModel } from './projection-model';
import './projection.css';

const MOBILE_QUERY = '(max-width: 768px)';
const subscribeMobile = (onChange: () => void) => {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;
const noSubscription = () => () => {};
const badgeSlot = () => document.getElementById(BADGE_SLOT_ID);

const SESSION_KEY = 'projection-open';
const COLLAPSE_KEY = 'projection-collapsed';

/** Compact floating projection of the two finalists, fed by the cockpit's national poll. */
export function ProjectionDock() {
  const { status } = useAccess();
  const national = useNational();
  const locked = status.state === 'locked';
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false);
  const claimed = useSyncExternalStore(subscribePanels, openFloatingPanel, () => null);
  const slot = useSyncExternalStore(noSubscription, badgeSlot, () => null);

  const [open, setOpen] = useState(false);
  // Phones start collapsed (strip only); expand for the full estimate.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') setOpen(true);
      if (sessionStorage.getItem(COLLAPSE_KEY) === '0') setCollapsed(false);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [open]);

  useEffect(() => {
    try {
      sessionStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Another panel claimed the phone viewport → close this one.
  useEffect(() => {
    if (mobile && claimed === 'chat' && open) setOpen(false);
  }, [claimed, mobile, open]);

  useEffect(() => {
    if (!open) {
      releasePanel('projection');
      return;
    }
    if (mobile) claimPanel('projection');
    else releasePanel('projection');
  }, [open, mobile]);

  if (locked) return null;

  const model = projectionModel(national?.snapshot ?? null);

  const toggle = () => {
    setOpen((was) => {
      const next = !was;
      if (next && mobile) setCollapsed(true);
      return next;
    });
  };

  const launcher = (
    <button
      type="button"
      className={open ? 'projection-launcher is-open' : 'projection-launcher'}
      onClick={toggle}
      aria-expanded={open}
      aria-controls="projection-panel"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Projeção
    </button>
  );

  return (
    <>
      {slot && createPortal(launcher, slot)}
      <aside
        id="projection-panel"
        className={[
          'projection-panel',
          open && 'is-open',
          mobile && collapsed && 'is-collapsed',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="Projeção da votação"
        hidden={!open}
      >
        <header className="projection-header">
          <h2>Projeção</h2>
          {model.state === 'estimate' && <span className="projection-tag">Estimativa</span>}
          {model.state === 'final' && <span className="projection-tag is-final">Resultado</span>}
          {mobile && model.state !== 'unavailable' && (
            <button
              type="button"
              className="projection-icon-btn"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expandir projeção' : 'Recolher projeção'}
              title={collapsed ? 'Expandir' : 'Recolher'}
            >
              {collapsed ? '⌃' : '⌄'}
            </button>
          )}
          <button
            type="button"
            className="projection-icon-btn"
            onClick={() => setOpen(false)}
            aria-label="Fechar a projeção"
          >
            ×
          </button>
        </header>
        {mobile && collapsed && model.state !== 'unavailable' && (
          <ProjectionStrip model={model} />
        )}
        <div className="projection-body">
          <ProjectionBody model={model} />
        </div>
      </aside>
    </>
  );
}

function ProjectionStrip({ model }: { model: Exclude<ProjectionModel, { state: 'unavailable' }> }) {
  const leader = model.first;
  return (
    <div className="projection-strip" role="status">
      <span className="projection-strip-leader" style={{ color: leader.color }}>
        {leader.name}
      </span>
      <span className="projection-strip-pct" style={{ color: leader.color }}>
        {percent(leader.projectedPercentage)}%
      </span>
      <span className="projection-strip-gap">
        {model.state === 'estimate' ? 'proj. · ' : ''}
        +{percent(model.gapPoints)} pp
      </span>
    </div>
  );
}

function ProjectionBody({ model }: { model: ProjectionModel }) {
  if (model.state === 'unavailable')
    return <p className="projection-empty">{model.reason}</p>;

  const estimate = model.state === 'estimate';
  return (
    <>
      <p className="projection-lead">
        {estimate ? (
          <>
            Se o ritmo atual se mantiver · <b>estimativa</b>
          </>
        ) : (
          <>Apuração encerrada · resultado oficial</>
        )}
      </p>
      <div className="projection-rows">
        {[model.first, model.second].map((side) => (
          <div key={side.id} className="projection-row">
            <span className="projection-row-name">{side.name}</span>
            <span className="projection-row-pct" style={{ color: side.color }}>
              {percent(side.projectedPercentage)}
              <small>%</small>
            </span>
            <div className="projection-bar" aria-hidden="true">
              <span
                style={{
                  width: `${Math.min(100, Math.max(0, side.projectedPercentage))}%`,
                  background: side.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="projection-meta">
        <span>
          Apurado <b>{percent(model.counted)}%</b>
        </span>
        {estimate && (
          <>
            <span>
              Falta <b>{percent(model.remainingPercent)}%</b>
            </span>
            {model.remainingSections > 0 && (
              <span>
                <b>{number(model.remainingSections)}</b> seções
              </span>
            )}
          </>
        )}
        <span>
          Gap <b>{percent(model.gapPoints)}</b> pp
        </span>
      </p>
      {estimate && (
        <p className="projection-note">
          Estimativa com base no ritmo atual. Não é resultado oficial.
        </p>
      )}
    </>
  );
}
