import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { snapshotResponse } from '../src/lib/tse/snapshot-response';
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
