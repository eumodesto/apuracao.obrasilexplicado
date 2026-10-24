'use client';
import { useSyncExternalStore } from 'react';
import { SIDE_COLORS } from '@/features/landing/round-band-model';
import './online-parties.css';

export type OnlineParties = { PT: number; PL: number };

/**
 * The chat stream reports how many people online chose the PT or the PL; it publishes each
 * report here so the panel header can show the split without asking the server again.
 */
// On globalThis: the chat and the panel may load this module separately.
const store = ((globalThis as { __onlineParties?: unknown }).__onlineParties ??= {
  latest: null,
  listeners: new Set(),
}) as { latest: OnlineParties | null; listeners: Set<() => void> };

export function publishOnlineParties(value: OnlineParties | null | undefined) {
  if (!value || typeof value.PT !== 'number' || typeof value.PL !== 'number') return;
  if (store.latest && store.latest.PT === value.PT && store.latest.PL === value.PL) return;
  store.latest = { PT: value.PT, PL: value.PL };
  store.listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  store.listeners.add(listener);
  return () => void store.listeners.delete(listener);
};

const percent = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

/** Share of PT and PL among the people online who chose one of them (not the vote count). */
export function OnlinePartiesBadge() {
  const counts = useSyncExternalStore(
    subscribe,
    () => store.latest,
    () => null,
  );
  const total = (counts?.PT ?? 0) + (counts?.PL ?? 0);
  if (!counts || !total) return null;
  const pt = (counts.PT / total) * 100;
  const pl = 100 - pt;
  return (
    <div
      className="online-parties"
      title={`Entre as pessoas online que escolheram um partido: ${counts.PT} do PT e ${counts.PL} do PL. Não é resultado da eleição.`}
      aria-label={`Online agora: PT ${percent(pt)}%, PL ${percent(pl)}%`}
    >
      <small>Online agora</small>
      <div className="online-parties-row">
        <b style={{ color: SIDE_COLORS.left }}>PT {percent(pt)}%</b>
        <span className="online-parties-bar" aria-hidden="true">
          <i style={{ width: `${pt}%`, background: SIDE_COLORS.left }} />
          <i style={{ width: `${pl}%`, background: SIDE_COLORS.right }} />
        </span>
        <b style={{ color: SIDE_COLORS.right }}>{percent(pl)}% PL</b>
      </div>
    </div>
  );
}
