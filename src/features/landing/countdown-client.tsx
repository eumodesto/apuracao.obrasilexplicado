'use client';
import { useEffect, useSyncExternalStore } from 'react';

const two = (value: number) => String(value).padStart(2, '0');

/** "5 dias · 00:56:03", "1 dia · 23:59:59" or, on the day, "00:56:03". */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const clock = `${two(Math.floor((total % 86_400) / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
  return days > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'} · ${clock}` : clock;
}

const subscribeSecond = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
};
const nowSecond = () => Math.floor(Date.now() / 1000);

export function CountdownClock({ startsAt }: { startsAt: number }) {
  // Server render shows nothing time-dependent; the browser fills in its own clock.
  const second = useSyncExternalStore(subscribeSecond, nowSecond, () => null);
  const left = second === null ? null : startsAt - second * 1000;

  // When the time comes, reload: the server then serves the panel.
  useEffect(() => {
    if (left !== null && left <= 0) window.location.reload();
  }, [left]);

  return (
    <strong className="landing-clock" suppressHydrationWarning>
      {left === null ? '—' : formatCountdown(left)}
    </strong>
  );
}
