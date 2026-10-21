import { CandidateColors, buildMapSnapshot } from './map-normalizers';
import type { ElectionMapResponse, StateInput } from './map-types';
import type { ElectionResponse, Geography } from './types';
export type TrackingSignals = { signals: Record<string, string>; issue: string | null };
export type MapDependencies = {
  geography: () => Promise<Geography[]>;
  national: () => Promise<ElectionResponse>;
  tracking: () => Promise<TrackingSignals>;
  state: (uf: string) => Promise<ElectionResponse>;
  cachedState: (uf: string) => ElectionResponse | null;
};
/** Aggregated read-through view over the existing shared state cache, not a second data source. */
export class MapCoordinator {
  private pending: Promise<ElectionMapResponse> | null = null;
  private result: ElectionMapResponse | null = null;
  private nextRefresh = 0;
  private signals = new Map<string, string>();
  private inputs = new Map<string, StateInput>();
  private fallbackAt = new Map<string, number>();
  private signature = '';
  private colors = new CandidateColors();
  constructor(
    private dependencies: MapDependencies,
    private definitions: { uf: string; name: string; region: string }[],
    private pollMs: number,
    private staleMs: number,
    private now = Date.now,
  ) {}
  async read(): Promise<ElectionMapResponse> {
    if (this.result && this.now() < this.nextRefresh) return this.result;
    this.pending ??= this.refresh().finally(() => (this.pending = null));
    // Once a map exists, everyone gets it at once while the next one is built (27 UF reads).
    if (this.result && this.serveStale) {
      this.pending.catch((error) =>
        console.warn('[TSE] map refresh failed; keeping the previous map', error?.message ?? error),
      );
      return this.result;
    }
    return this.pending;
  }
  /** Answer from the previous map while a refresh runs (production server). */
  serveStale = false;
  private async refresh(): Promise<ElectionMapResponse> {
    const [geography, national, tracking] = await Promise.all([
      this.dependencies.geography(),
      this.dependencies.national(),
      this.dependencies.tracking(),
    ]);
    const inputs: StateInput[] = [];
    // Do not reserve 27 HTTP slots up front: interactive filters can use the
    // shared client's next slot between map reads.
    for (const definition of this.definitions) {
      const next = await (async () => {
        const previous = this.inputs.get(definition.uf);
        const available = geography.some((g) => g.code === definition.uf);
        const signal = tracking.signals[definition.uf] ?? '';
        const cached = this.dependencies.cachedState(definition.uf);
        // EA14 is an indicator, not an atomic manifest. A 60s safety revalidation catches
        // corrections or CDN ordering where the indicator does not change as expected.
        const needsRead =
          available &&
          (!previous ||
            !previous.snapshot ||
            !!previous.issue ||
            signal !== this.signals.get(definition.uf) ||
            this.now() >= (this.fallbackAt.get(definition.uf) ?? 0));
        const response = needsRead ? await this.dependencies.state(definition.uf) : cached;
        const snapshot = response?.snapshot ?? previous?.snapshot ?? null;
        const outdated =
          !!snapshot &&
          snapshot.status === 'counting' &&
          this.now() - Date.parse(snapshot.progress.totaledAt ?? snapshot.progress.generatedAt) >
            this.staleMs;
        const input: StateInput = {
          ...definition,
          snapshot,
          stale: !!response?.stale || outdated || !snapshot,
          issue: response?.issue ?? (!available ? 'UF indisponível no catálogo oficial.' : null),
        };
        if (needsRead && snapshot && !response?.issue) {
          this.fallbackAt.set(definition.uf, this.now() + 60000);
          // If the result has not caught up with the tracking timestamp, try again next cycle.
          const expected = signal?.split('|')[0];
          if (
            !expected ||
            Date.parse(snapshot.progress.totaledAt ?? snapshot.progress.generatedAt) >=
              Date.parse(expected)
          )
            this.signals.set(definition.uf, signal ?? '');
        }
        this.inputs.set(definition.uf, input);
        return input;
      })();
      inputs.push(next);
    }
    const issue =
      national.issue ??
      (tracking.issue
        ? 'O acompanhamento oficial está temporariamente indisponível.'
        : national.stale
          ? 'A atualização nacional está indisponível ou desatualizada.'
          : null);
    const signature = JSON.stringify({
      national: national.snapshot?.version,
      status: national.status,
      issue,
      states: inputs.map((i) => [i.uf, i.snapshot?.version, i.stale, i.issue]),
    });
    if (!this.result || signature !== this.signature) {
      this.result = {
        snapshot: buildMapSnapshot(inputs, national.snapshot, this.colors, issue),
        nextPollMs: this.pollMs,
        staleAfterMs: this.staleMs,
      };
      this.signature = signature;
    }
    this.nextRefresh = this.now() + this.pollMs;
    return this.result;
  }
}
