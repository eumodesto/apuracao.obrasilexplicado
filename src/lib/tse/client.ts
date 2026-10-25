import type { CacheEntry, SnapshotCache } from './cache';
export type Resource<T> = {
  attemptedAt?: number | null;
  value: T | null;
  issue: string | null;
  checkedAt: number | null;
  nextAttempt: number;
};
type State = {
  attemptedAt?: number;
  value: unknown;
  entry?: CacheEntry;
  nextAttempt: number;
  failures: number;
  issue: string | null;
};
class UpstreamError extends Error {
  constructor(
    public code: string,
    public retryMs = 0,
  ) {
    super(code);
  }
}
export class TseClient {
  private states = new Map<string, State>();
  private flights = new Map<string, Promise<Resource<unknown>>>();
  private blockedUntil = 0;
  private nextSlot = 0;
  get cooldownUntil() {
    return this.blockedUntil;
  }
  pause(milliseconds: number) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + milliseconds);
  }
  /** Inspect the already validated resource without making an upstream request. */
  peek<T>(url: string): Resource<T> | null {
    const state = this.states.get(url);
    if (!state) return null;
    return {
      value: state.value as T | null,
      issue: state.issue ?? (this.blockedUntil > this.now() ? 'upstream cooldown' : null),
      checkedAt: state.entry?.checkedAt ?? null,
      attemptedAt: state.attemptedAt ?? null,
      nextAttempt: Math.max(state.nextAttempt, this.blockedUntil),
    };
  }
  constructor(
    private cache: SnapshotCache,
    private transport: typeof fetch = fetch,
    private now = Date.now,
    private spacingMs = 250,
  ) {}
  /** Hydrate a durable result without spending an upstream request or clearing backoff. */
  async restore<T>(url: string, parse: (input: unknown) => T): Promise<Resource<T> | null> {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.origin !== 'https://resultados.tse.jus.br' ||
      !parsedUrl.pathname.startsWith('/oficial/')
    )
      throw new Error('Disallowed source');
    if (this.states.get(url)?.value) return this.peek<T>(url);
    const saved = await this.cache.get(url);
    if (!saved) return this.peek<T>(url);
    try {
      const value = parse(JSON.parse(saved.body));
      const previous = this.states.get(url);
      this.states.set(url, {
        value,
        entry: saved,
        nextAttempt: previous?.nextAttempt ?? 0,
        failures: previous?.failures ?? 0,
        issue: previous?.issue ?? null,
        attemptedAt: previous?.attemptedAt,
      });
    } catch {
      /* Corrupt or incompatible cache cannot color a municipality. */
    }
    return this.peek<T>(url);
  }
  async read<T>(url: string, parse: (input: unknown) => T, interval: number): Promise<Resource<T>> {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.origin !== 'https://resultados.tse.jus.br' ||
      !parsedUrl.pathname.startsWith('/oficial/')
    )
      throw new Error('Disallowed source');
    let flight = this.flights.get(url) as Promise<Resource<T>> | undefined;
    if (!flight) {
      flight = this.refresh(url, parse, interval).finally(() => this.flights.delete(url));
      this.flights.set(url, flight);
    }
    // With a validated value in hand, answer at once and let the refresh finish in the background:
    // under load nobody waits for the TSE or for the request spacing queue.
    const state = this.states.get(url);
    if (this.serveStale && state?.value != null) {
      flight.catch(() => {});
      return this.current<T>(state);
    }
    return flight;
  }
  /** Answer reads from the last validated value while a refresh runs (production server). */
  serveStale = false;
  private current<T>(state: State): Resource<T> {
    return {
      attemptedAt: state.attemptedAt ?? null,
      value: state.value as T | null,
      issue: state.issue ?? (this.blockedUntil > this.now() ? 'HTTP 429' : null),
      checkedAt: state.entry?.checkedAt ?? null,
      nextAttempt: Math.max(state.nextAttempt, this.blockedUntil),
    };
  }
  private async refresh<T>(
    url: string,
    parse: (input: unknown) => T,
    interval: number,
  ): Promise<Resource<T>> {
    let state = this.states.get(url);
    if (!state) {
      state = { value: null, nextAttempt: 0, failures: 0, issue: null };
      this.states.set(url, state);
      const saved = await this.cache.get(url);
      if (saved)
        try {
          state.value = parse(JSON.parse(saved.body));
          state.entry = saved;
        } catch {
          /* Reject corrupted or incompatible disk snapshot. */
        }
    }
    const respond = (): Resource<T> => ({
      attemptedAt: state.attemptedAt ?? null,
      value: state.value as T | null,
      issue: state.issue ?? (this.blockedUntil > this.now() ? 'HTTP 429' : null),
      checkedAt: state.entry?.checkedAt ?? null,
      nextAttempt: Math.max(state.nextAttempt, this.blockedUntil),
    });
    if (this.now() < Math.max(state.nextAttempt, this.blockedUntil)) return respond();
    const slot = Math.max(this.now(), this.nextSlot);
    this.nextSlot = slot + this.spacingMs;
    if (slot > this.now()) await new Promise((resolve) => setTimeout(resolve, slot - this.now()));
    if (this.blockedUntil > this.now()) return respond();
    try {
      state.attemptedAt = this.now();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (state.entry?.etag) headers['If-None-Match'] = state.entry.etag;
      if (state.entry?.modified) headers['If-Modified-Since'] = state.entry.modified;
      const response = await this.transport(url, {
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 304 && state.entry) {
        state.entry.checkedAt = this.now();
        console.info('[TSE] 304 unchanged');
      } else {
        if (!response.ok) {
          const retry = response.headers.get('retry-after');
          let retryMs = 0;
          if (retry) {
            if (/^\d+$/.test(retry)) retryMs = Number(retry) * 1000;
            else {
              const until = Date.parse(retry) - this.now();
              retryMs = Number.isFinite(until) ? Math.max(0, until) : 0;
            }
          }
          throw new UpstreamError(`HTTP ${response.status}`, retryMs);
        }
        const body = await response.text();
        if (body.length > 8_000_000) throw new UpstreamError('oversized response');
        let raw: unknown;
        try {
          raw = JSON.parse(body);
        } catch {
          throw new UpstreamError('invalid JSON');
        }
        let value: T;
        try {
          value = parse(raw);
        } catch {
          throw new UpstreamError('unexpected schema');
        }
        // CDN nodes may temporarily serve an older generation. Never regress timestamp.
        const previous = state.value as { progress?: { generatedAt?: string } } | null;
        const incoming = value as { progress?: { generatedAt?: string } };
        if (
          previous?.progress?.generatedAt &&
          incoming?.progress?.generatedAt &&
          Date.parse(incoming.progress.generatedAt) < Date.parse(previous.progress.generatedAt)
        )
          throw new UpstreamError('older generation');
        state.value = state.entry?.body === body ? state.value : value;
        state.entry = {
          body,
          etag: response.headers.get('etag'),
          modified: response.headers.get('last-modified'),
          checkedAt: this.now(),
        };
        await this.cache.set(url, state.entry);
        console.info('[TSE] 200 result updated');
      }
      state.failures = 0;
      state.issue = null;
      state.nextAttempt = this.now() + interval;
    } catch (error) {
      state.failures++;
      const issue =
        error instanceof UpstreamError
          ? error.code
          : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? 'timeout'
            : 'connection error';
      // 404/400 stay per-URL (missing municipal/zone/photo files must not freeze the national feed).
      // Only rate-limit style responses pause every JSON fetch in this process.
      const missing = issue === 'HTTP 404' || issue === 'HTTP 400';
      const rateLimited = issue === 'HTTP 429' || issue === 'HTTP 403';
      const base = missing ? 30_000 : rateLimited ? 610_000 : 10_000;
      const cap = missing ? 120_000 : 3_600_000;
      const suggested = error instanceof UpstreamError ? error.retryMs : 0;
      const delay = Math.max(
        Math.min(base * 2 ** Math.min(state.failures - 1, 6), cap),
        Number.isFinite(suggested) ? suggested : 0,
      );
      state.nextAttempt = this.now() + delay;
      if (rateLimited) this.blockedUntil = state.nextAttempt;
      state.issue = issue;
      console.warn(
        `[TSE] ${issue} — backing off; ${state.value ? 'keeping previous snapshot' : 'no snapshot'}`,
      );
    }
    return respond();
  }
}
