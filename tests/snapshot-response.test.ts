import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import {
  cachedSnapshot,
  encodeBody,
  respondBody,
  snapshotResponse,
} from '../src/lib/tse/snapshot-response';
describe('Complete municipal response delivery', () => {
  const payload = {
    results: Array.from({ length: 5571 }, (_, code) => ({
      code,
      name: 'municipality '.repeat(60),
    })),
  };
  it('delivers large frames compressed without losing results and preserves conditional requests', async () => {
    const response = snapshotResponse(
      new Request('http://localhost', { headers: { 'accept-encoding': 'gzip, br' } }),
      payload,
    );
    expect(response.headers.get('content-encoding')).toBe('gzip');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBeLessThan(4_500_000);
    expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(payload);
    const unchanged = snapshotResponse(
      new Request('http://localhost', {
        headers: { 'accept-encoding': 'gzip', 'if-none-match': response.headers.get('etag')! },
      }),
      payload,
    );
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
  });
  it('streams large identity responses and respects gzip q=0', async () => {
    const response = snapshotResponse(
      new Request('http://localhost', { headers: { 'accept-encoding': 'gzip;q=0' } }),
      payload,
    );
    expect(response.headers.has('content-encoding')).toBe(false);
    const reader = response.body!.getReader();
    let chunks = 0,
      text = '';
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks++;
      text += decoder.decode(value, { stream: true });
    }
    expect(chunks).toBeGreaterThan(1);
    expect(JSON.parse(text)).toEqual(payload);
  });
});

describe('Shared election frames', () => {
  it('builds and encodes once per window, serves stale while refreshing, and shares one flight', async () => {
    let clock = 1_000;
    let builds = 0;
    const build = async () => ({ n: ++builds, pad: 'x'.repeat(40_000) });
    const now = () => clock;
    const [a, b, c] = await Promise.all([
      cachedSnapshot('t:shared', 3_000, build, now),
      cachedSnapshot('t:shared', 3_000, build, now),
      cachedSnapshot('t:shared', 3_000, build, now),
    ]);
    expect(builds).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a.gzip).not.toBeNull();
    clock += 1_000;
    expect(await cachedSnapshot('t:shared', 3_000, build, now)).toBe(a);
    expect(builds).toBe(1);
    // Expired: the old bytes answer at once while a single refresh runs in the background.
    clock += 5_000;
    expect(await cachedSnapshot('t:shared', 3_000, build, now)).toBe(a);
    await new Promise((done) => setTimeout(done, 20));
    expect(builds).toBe(2);
    const fresh = await cachedSnapshot('t:shared', 3_000, build, now);
    expect(fresh).not.toBe(a);
    expect(JSON.parse(Buffer.from(fresh.identity).toString()).n).toBe(2);
  });
});

describe('Shared JSON bodies', () => {
  const data = { races: Array.from({ length: 200 }, (_, i) => ({ uf: i, name: 'x'.repeat(30) })) };
  const text = JSON.stringify(data);

  it('serves gzip once compressed, plain otherwise, with separate ETags and the route headers', async () => {
    const body = await encodeBody(text, '"abc"', { 'X-Poll-After': '30000' });
    const zipped = respondBody(
      new Request('http://localhost', { headers: { 'accept-encoding': 'gzip, br' } }),
      body,
    );
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    expect(zipped.headers.get('etag')).toBe('"abc-gzip"');
    expect(zipped.headers.get('x-poll-after')).toBe('30000');
    expect(zipped.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(gunzipSync(Buffer.from(await zipped.arrayBuffer())).toString())).toEqual(data);

    const plain = respondBody(new Request('http://localhost'), body);
    expect(plain.headers.has('content-encoding')).toBe(false);
    expect(plain.headers.get('etag')).toBe('"abc"');
    expect(await plain.json()).toEqual(data);
  });

  it('answers 304 per variant and skips gzip for tiny bodies', async () => {
    const body = await encodeBody(text, '"abc"', {});
    const unchanged = respondBody(
      new Request('http://localhost', {
        headers: { 'accept-encoding': 'gzip', 'if-none-match': '"abc-gzip"' },
      }),
      body,
    );
    expect(unchanged.status).toBe(304);
    // A plain client holding the gzip tag is not told "unchanged": it never received that variant.
    const other = respondBody(
      new Request('http://localhost', { headers: { 'if-none-match': '"abc-gzip"' } }),
      body,
    );
    expect(other.status).toBe(200);

    const tiny = await encodeBody('{"a":1}', '"t"', {});
    expect(tiny.gzip).toBeNull();
    const response = respondBody(
      new Request('http://localhost', { headers: { 'accept-encoding': 'gzip' } }),
      tiny,
    );
    expect(response.headers.has('content-encoding')).toBe(false);
    expect(response.headers.get('etag')).toBe('"t"');
  });
});