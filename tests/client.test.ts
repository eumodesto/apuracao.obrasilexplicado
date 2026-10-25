import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../src/lib/tse/cache';
import { TseClient } from '../src/lib/tse/client';
const url = 'https://resultados.tse.jus.br/oficial/test.json';
const parse = (raw: unknown) => {
  if (!raw || typeof raw !== 'object' || !('votes' in raw) || typeof raw.votes !== 'number')
    throw new Error('schema');
  return raw as { votes: number };
};
function setup(responses: (Response | Error)[]) {
  let now = 1000000;
  const fetcher = vi.fn(async () => {
    const item = responses.shift();
    if (item instanceof Error) throw item;
    if (!item) throw new Error('No response');
    return item;
  });
  return {
    client: new TseClient(new MemoryCache(), fetcher as typeof fetch, () => now, 0),
    fetcher,
    advance: (ms = 3001) => {
      now += ms;
    },
  };
}
const success = () =>
  new Response('{"votes":0}', {
    headers: { etag: '"one"', 'last-modified': 'Sun, 04 Oct 2026 19:00:00 GMT' },
  });
describe('Conditional requests and resilient snapshots', () => {
  it('restores newly collected durable results without a request or clearing backoff', async () => {
    const cache = new MemoryCache();
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    const client = new TseClient(cache, fetcher, () => 1000000, 0);
    await client.read(url, parse, 3000);
    client.pause(60000);
    await cache.set(url, { body: '{"votes":42}', checkedAt: 999999, etag: null, modified: null });
    const result = await client.restore(url, parse);
    expect(result?.value).toEqual({ votes: 42 });
    expect(result?.nextAttempt).toBe(1060000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects incompatible collected cache and non-official restoration URLs', async () => {
    const cache = new MemoryCache();
    const fetcher = vi.fn();
    const client = new TseClient(cache, fetcher, Date.now, 0);
    await cache.set(url, { body: '{"votes":"wrong"}', checkedAt: 1, etag: null, modified: null });
    expect(await client.restore(url, parse)).toBeNull();
    await expect(client.restore('https://example.com/result.json', parse)).rejects.toThrow(
      'Disallowed',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('shares an upstream cooldown with photo requests', async () => {
    const { client, fetcher } = setup([]);
    client.pause(610000);
    expect(client.cooldownUntil).toBe(1610000);
    const response = await client.read(url, parse, 3000);
    expect(response.value).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('handles 200, coalesces 1000 callers and sends both validators on 304', async () => {
    const { client, fetcher, advance } = setup([success(), new Response(null, { status: 304 })]);
    const first = await Promise.all(
      Array.from({ length: 1000 }, () => client.read(url, parse, 3000)),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance();
    const second = await client.read(url, parse, 3000);
    expect(second.value).toBe(first[0].value);
    expect(fetcher.mock.calls[1]).toBeDefined();
    const options = (fetcher.mock.calls as unknown[][])[1][1] as RequestInit;
    expect(options.headers).toMatchObject({
      'If-None-Match': '"one"',
      'If-Modified-Since': 'Sun, 04 Oct 2026 19:00:00 GMT',
    });
  });
  it.each([400, 404, 429, 500, 502, 503, 504])(
    'preserves snapshot and backs off HTTP %i',
    async (status) => {
      const { client, fetcher, advance } = setup([success(), new Response(null, { status })]);
      const first = await client.read(url, parse, 3000);
      advance();
      const failed = await client.read(url, parse, 3000);
      expect(failed.value).toBe(first.value);
      expect(failed.issue).toBe(`HTTP ${status}`);
      await client.read(url, parse, 3000);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each([
    new Response('broken'),
    new Response('{"unexpected":true}'),
    new DOMException('timeout', 'TimeoutError'),
    new Error('ECONNRESET'),
  ])('keeps previous valid values on malformed payload or transport failure', async (response) => {
    const { client, advance } = setup([success(), response]);
    await client.read(url, parse, 3000);
    advance();
    const failed = await client.read(url, parse, 3000);
    expect(failed.value).toEqual({ votes: 0 });
    expect(failed.issue).not.toBeNull();
  });
  it('has no invented snapshot before publication', async () => {
    const { client } = setup([new Response(null, { status: 404 })]);
    const r = await client.read(url, parse, 3000);
    expect(r.value).toBeNull();
    expect(r.nextAttempt).toBeGreaterThan(1000000 + 29_000);
    expect(r.nextAttempt).toBeLessThanOrEqual(1000000 + 120_000);
  });
  it('keeps 404 backoff on that URL only', async () => {
    const { client, fetcher } = setup([
      new Response(null, { status: 404 }),
      success(),
    ]);
    await client.read(url, parse, 3000);
    const other = await client.read(`${url}?other=1`, parse, 3000);
    expect(other.value).toEqual({ votes: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.cooldownUntil).toBe(0);
  });
  it('honors Retry-After and blocks different resources after 429', async () => {
    const { client, fetcher } = setup([
      new Response(null, { status: 429, headers: { 'retry-after': '1200' } }),
    ]);
    const r = await client.read(url, parse, 3000);
    expect(r.nextAttempt).toBe(2200000);
    await client.read(url + '2', parse, 3000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('ignores malformed Retry-After instead of disabling backoff', async () => {
    const { client } = setup([new Response(null, { status: 429, headers: { 'retry-after': 'soon' } })]);
    const r = await client.read(url, parse, 3000);
    expect(Number.isFinite(r.nextAttempt)).toBe(true);
    expect(r.nextAttempt).toBeGreaterThanOrEqual(1000000 + 610_000);
  });
  it('restores validated cached data after process restart even when TSE fails', async () => {
    const cache = new MemoryCache();
    await cache.set(url, { body: '{"votes":45}', etag: '"old"', modified: null, checkedAt: 1 });
    const client = new TseClient(
      cache,
      vi.fn().mockRejectedValue(new Error('offline')),
      Date.now,
      0,
    );
    expect((await client.read(url, parse, 3000)).value).toEqual({ votes: 45 });
  });
  it('does not persist malformed response', async () => {
    const cache = new MemoryCache();
    const client = new TseClient(
      cache,
      vi.fn().mockResolvedValue(new Response('{"votes":"invalid"}')),
      Date.now,
      0,
    );
    await client.read(url, parse, 3000);
    expect(await cache.get(url)).toBeUndefined();
  });
  it('rejects arbitrary origins', async () => {
    const { client } = setup([]);
    await expect(client.read('https://example.com', parse, 3000)).rejects.toThrow('Disallowed');
  });
});
describe('Serving the last value while refreshing (production)', () => {
  it('answers from the validated value at once and refreshes in the background', async () => {
    let release: (response: Response) => void = () => {};
    const responses: Promise<Response>[] = [
      Promise.resolve(success()),
      new Promise((resolve) => (release = resolve)),
    ];
    const fetcher = vi.fn(() => responses.shift()!);
    let now = 1000000;
    const client = new TseClient(new MemoryCache(), fetcher as typeof fetch, () => now, 0);
    client.serveStale = true;
    // Nothing validated yet: the first read waits for the TSE.
    expect((await client.read(url, parse, 3000)).value).toEqual({ votes: 0 });
    now += 3001;
    // The refresh is pending, but readers get the previous value immediately.
    expect((await client.read(url, parse, 3000)).value).toEqual({ votes: 0 });
    expect((await client.read(url, parse, 3000)).value).toEqual({ votes: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    release(new Response('{"votes":7}', { headers: { etag: '"two"' } }));
    await vi.waitFor(async () =>
      expect((await client.read(url, parse, 3000)).value).toEqual({ votes: 7 }),
    );
  });
});
