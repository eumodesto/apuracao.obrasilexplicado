/**
 * Warms the TSE data as soon as the server starts: the first map needs the 27 UFs, which takes
 * tens of seconds through the TSE request queue. Without this, the first visitors after a restart
 * (often at peak) wait for it. Not awaited: the server starts answering at once.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  const { electionMap } = await import('./lib/tse/map-service');
  const started = Date.now();
  electionMap().then(
    () => console.info(`[TSE] map warmed in ${Math.round((Date.now() - started) / 1000)} s`),
    (error) => console.warn('[TSE] map warm-up failed', error?.message ?? error),
  );
}
