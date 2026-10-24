'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type TimelineMoment = {
  id: string;
  observedAt: string;
  counted: number;
  candidates: { name: string; percentage: number; color: string }[];
};

/**
 * Only the latest run of the count, in time order: a drop in the counted share means the history
 * started over (a correction, or a new count), and mixing runs put the hours out of order.
 */
export function latestRun<T extends { counted: number; observedAt: string }>(moments: T[]): T[] {
  const ordered = [...moments].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  let start = 0;
  for (let i = 1; i < ordered.length; i++)
    if (ordered[i].counted < ordered[i - 1].counted - 0.5) start = i;
  return ordered.slice(start);
}

const clock = (iso: string, seconds = false) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    timeZone: 'America/Sao_Paulo',
  });
const percent = (value: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Hour marks across the period (every 15 min, 30 min or hours, depending on its length). */
function marks(start: number, end: number) {
  const span = end - start;
  if (span <= 0) return [];
  const step = [5, 10, 15, 30, 60, 120, 180, 360]
    .map((m) => m * 60_000)
    .find((s) => span / s <= 6)!;
  const first = Math.ceil(start / step) * step;
  const out: number[] = [];
  for (let t = first; t < end; t += step) if (t > start) out.push(t);
  return out;
}

/**
 * Timeline of the count: positions follow real time, the track shows how much was counted, and a
 * bubble follows the pointer with the time, the share counted and the leader. Dragging selects the
 * nearest observed moment; the panel updates while dragging (after a short pause) and on release.
 */
export function CountTimeline({
  moments: all,
  selectedId,
  loading,
  onSelect,
}: {
  moments: TimelineMoment[];
  /** '' = live (the latest moment). */
  selectedId: string;
  loading: boolean;
  /** Shows a moment; '' goes back to live. */
  onSelect: (id: string) => void;
}) {
  const moments = useMemo(() => latestRun(all), [all]);
  const times = useMemo(() => moments.map((m) => Date.parse(m.observedAt)), [moments]);
  const start = times[0] ?? 0,
    end = times.at(-1) ?? 0,
    span = Math.max(1, end - start);
  const position = (t: number) => ((t - start) / span) * 100;
  const liveIndex = moments.length - 1;
  const selectedIndex = selectedId ? moments.findIndex((m) => m.id === selectedId) : liveIndex;
  const [preview, setPreview] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = preview ?? (selectedIndex >= 0 ? selectedIndex : liveIndex);
  const moment = moments[shown];

  const choose = useCallback(
    (index: number) => onSelect(index >= liveIndex ? '' : (moments[index]?.id ?? '')),
    [liveIndex, moments, onSelect],
  );
  const nearest = useCallback(
    (clientX: number) => {
      const box = track.current!.getBoundingClientRect();
      const t = start + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * span;
      let best = 0;
      for (let i = 1; i < times.length; i++)
        if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
      return best;
    },
    [start, span, times],
  );
  // While dragging, the panel follows after a short pause, so it is not reloaded on every pixel.
  const follow = (index: number) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => choose(index), 180);
  };
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (moments.length < 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const index = nearest(event.clientX);
    setPreview(index);
    follow(index);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (moments.length < 2) return;
    const index = nearest(event.clientX);
    if (index === preview) return;
    setPreview(index);
    if (dragging) follow(index);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (pending.current) clearTimeout(pending.current);
    choose(nearest(event.clientX));
    setPreview(null);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = selectedIndex >= 0 ? selectedIndex : liveIndex;
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? current - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? current + 1
          : event.key === 'PageDown'
            ? current - 10
            : event.key === 'PageUp'
              ? current + 10
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? liveIndex
                  : null;
    if (next === null) return;
    event.preventDefault();
    choose(Math.min(liveIndex, Math.max(0, next)));
  };

  if (moments.length < 2)
    return (
      <div className="count-timeline is-empty">
        A linha do tempo aparece quando houver pelo menos dois momentos da apuração.
      </div>
    );

  const leader = moment && [...moment.candidates].sort((a, b) => b.percentage - a.percentage)[0];
  const thumb = position(times[shown]);
  const area = moments
    .map((m, i) => `${position(times[i]).toFixed(2)},${(100 - m.counted).toFixed(2)}`)
    .join(' ');
  const ticks = marks(start, end);
  return (
    <div
      className={`count-timeline${dragging ? ' is-dragging' : ''}${loading ? ' is-loading' : ''}`}
    >
      <div
        ref={track}
        className="count-timeline-track"
        role="slider"
        tabIndex={0}
        aria-label="Momento da apuração"
        aria-valuemin={0}
        aria-valuemax={liveIndex}
        aria-valuenow={shown}
        aria-valuetext={
          moment
            ? `${clock(moment.observedAt)}, ${percent(moment.counted)}% apurado${shown === liveIndex ? ', ao vivo' : ''}`
            : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDragging(false);
          setPreview(null);
        }}
        onPointerLeave={() => !dragging && setPreview(null)}
        onKeyDown={onKeyDown}
      >
        {/* How much was counted along the period. */}
        <svg
          className="count-timeline-area"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon points={`0,100 ${area} 100,100`} />
        </svg>
        <span className="count-timeline-rail" aria-hidden="true">
          <span style={{ width: `${thumb}%` }} />
        </span>
        <span className="count-timeline-thumb" style={{ left: `${thumb}%` }} aria-hidden="true" />
        {moment && (preview !== null || dragging) && (
          <span
            className="count-timeline-bubble"
            style={{ left: `${Math.min(88, Math.max(12, thumb))}%` }}
            aria-hidden="true"
          >
            <b>{shown === liveIndex ? 'Ao vivo' : clock(moment.observedAt, true)}</b>
            <span>{percent(moment.counted)}% apurado</span>
            {leader && (
              <span style={{ color: leader.color }}>
                {leader.name} {percent(leader.percentage)}%
              </span>
            )}
          </span>
        )}
      </div>
      <div className="count-timeline-marks" aria-hidden="true">
        <span style={{ left: '0%' }}>{clock(moments[0].observedAt)}</span>
        {ticks.map((t) => (
          <span key={t} style={{ left: `${position(t)}%` }}>
            {clock(new Date(t).toISOString())}
          </span>
        ))}
        <span style={{ left: '100%' }}>Agora</span>
      </div>
    </div>
  );
}
