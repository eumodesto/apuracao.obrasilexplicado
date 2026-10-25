/**
 * Warms the TSE data as soon as the server starts. National Brasil + Exterior load first so the
 * panel never waits behind the 27-state map queue; the map follows. Not awaited: the server
 * starts answering at once.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  const started = Date.now();
  const { president } = await import('./lib/tse/service');
  const { electionMap } = await import('./lib/tse/map-service');
  void (async () => {
    try {
      const [br, zz] = await Promise.all([president({}), president({ scope: 'exterior' })]);
      console.info(
        `[TSE] national warmed in ${Math.round((Date.now() - started) / 1000)} s` +
          ` · BR ${br.status}${br.snapshot ? ` (${br.snapshot.candidates.length})` : ''}` +
          ` · ZZ ${zz.status}${zz.snapshot ? ` (${zz.snapshot.candidates.length})` : ''}`,
      );
    } catch (error) {
      console.warn('[TSE] national warm-up failed', error instanceof Error ? error.message : error);
    }
    try {
      await electionMap();
      console.info(`[TSE] map warmed in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (error) {
      console.warn('[TSE] map warm-up failed', error instanceof Error ? error.message : error);
    }
  })();
}
