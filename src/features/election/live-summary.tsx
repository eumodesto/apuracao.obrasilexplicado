'use client';
import { useSyncExternalStore } from 'react';
import { editorialName } from '@/features/election/cockpit/editorial-name';
import { candidateColor } from '@/lib/tse/candidate-colors';
import type { ElectionResponse } from '@/lib/tse/types';

/**
 * The panel already polls the national result; it publishes each one here so other parts of the
 * page (the chat on phones) can show a live summary without asking the server again.
 */
// On globalThis: the panel and the chat may load this module separately.
const store = ((globalThis as { __national?: unknown }).__national ??= {
  latest: null,
  listeners: new Set(),
}) as { latest: ElectionResponse | null; listeners: Set<() => void> };

export function publishNational(data: ElectionResponse | null) {
  if (data === store.latest) return;
  store.latest = data;
  store.listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  store.listeners.add(listener);
  return () => void store.listeners.delete(listener);
};

export const useNational = () =>
  useSyncExternalStore(
    subscribe,
    () => store.latest,
    () => null,
  );

const votes = (value: number) => `${value.toLocaleString('pt-BR')} votos`;
const percent = (value: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The two leading candidates, their share bar and how much has been counted. */
export function LiveSummary() {
  const national = useNational();
  const snapshot = national?.snapshot;
  if (!snapshot)
    return (
      <div className="live-summary is-empty" role="status">
        Aguardando a apuração do TSE…
      </div>
    );
  const top = [...snapshot.candidates].sort((a, b) => b.votes - a.votes).slice(0, 2);
  const total = top.reduce((sum, c) => sum + c.percentage, 0) || 1;
  return (
    <section className="live-summary" aria-label="Resumo da apuração ao vivo">
      <div className="live-summary-sides">
        {top.map((candidate, index) => (
          <div
            key={candidate.id}
            className={index ? 'live-summary-side is-right' : 'live-summary-side'}
            style={{ '--side': candidateColor(candidate) } as React.CSSProperties}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/election/photo/${candidate.id}`}
              alt=""
              width={44}
              height={44}
              loading="lazy"
            />
            <div>
              <span className="live-summary-name">{editorialName(candidate.ballotName)}</span>
              <b className="live-summary-share">
                {percent(candidate.percentage)}
                <small>%</small>
              </b>
              <span className="live-summary-votes">{votes(candidate.votes)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="live-summary-bar" aria-hidden="true">
        {top.map((candidate) => (
          <span
            key={candidate.id}
            style={{
              width: `${(candidate.percentage / total) * 100}%`,
              background: candidateColor(candidate),
            }}
          />
        ))}
        <i className="live-summary-half" />
      </div>
      <p className="live-summary-progress">
        <span className="live-summary-dot" aria-hidden="true" />
        <b>{percent(snapshot.progress.percentageCounted)}%</b> das urnas apuradas
        {snapshot.status === 'finished' ? ' · apuração encerrada' : ' · ao vivo'}
      </p>
    </section>
  );
}
