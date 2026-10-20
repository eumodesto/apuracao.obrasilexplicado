import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { formatCountdown } from '../src/features/landing/countdown-client';
import { discoverElection, roundConfig } from '../src/lib/tse/config';
import { cleanEmail, FileNotifyStore } from '../src/lib/notify/store';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));

/** The TSE configuration once the 2nd round is published. */
function withSecondRound() {
  const config = fixture('ele-c');
  config.pl.push({
    cd: '3221',
    c: 'ele2026',
    dt: '25/10/2026',
    e: [{ cd: '6258', t: '2', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] }],
  });
  return config;
}

describe('countdown', () => {
  it('shows days and a clock, then only the clock on the day', () => {
    const at = (d: number, h: number, m: number, s: number) =>
      ((d * 24 + h) * 3600 + m * 60 + s) * 1000 + 999;
    expect(formatCountdown(at(5, 0, 56, 3))).toBe('5 dias · 00:56:03');
    expect(formatCountdown(at(1, 23, 59, 59))).toBe('1 dia · 23:59:59');
    expect(formatCountdown(at(0, 2, 3, 4))).toBe('02:03:04');
    expect(formatCountdown(-5000)).toBe('00:00:00');
  });
});

describe('notify e-mails', () => {
  it('accepts real-looking addresses only', () => {
    expect(cleanEmail('  Ana.Souza@Gmail.com ')).toBe('ana.souza@gmail.com');
    for (const bad of ['', 'ana', 'ana@', 'ana@gmail', 'a b@c.com', 42, null])
      expect(cleanEmail(bad), String(bad)).toBeNull();
  });

  it('stores each address once and keeps it in the file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'notify-'));
    try {
      const file = path.join(dir, 'notify.json');
      const store = new FileNotifyStore(file);
      expect(await store.add('ana@gmail.com', 1)).toBe('added');
      expect(await store.add('ana@gmail.com', 2)).toBe('exists');
      expect(await new FileNotifyStore(file).list()).toEqual([
        { email: 'ana@gmail.com', createdAt: 1 },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('1st round during the 2nd', () => {
  it('derives the 1st-round configuration from the active one', () => {
    const active = discoverElection(withSecondRound(), undefined);
    expect(active).toMatchObject({ election: '6258', turn: '2' });
    expect(roundConfig(active, '1')).toMatchObject({
      election: '6257',
      contest: '3220',
      turn: '1',
      date: '04/10/2026',
      directories: active.directories,
    });
    expect(roundConfig(discoverElection(fixture('ele-c'), undefined), '2')).toBeNull();
  });

  let cacheDir = '';
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  });

  it('reads Brazil, the 27 states and abroad from the 1st-round files', async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), 'tse-'));
    vi.stubEnv('TSE_CACHE_DIR', cacheDir);
    const state = fixture('president-pb');
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith('/comum/config/ele-c.json')) return Response.json(withSecondRound());
        const match = /\/6257\/dados\/([a-z]{2})\/([a-z]{2})-c0001-e006257-u\.json$/.exec(url);
        if (!match) return new Response('not found', { status: 404 });
        const uf = match[1];
        if (uf === 'br') return Response.json(fixture('president-br'));
        if (uf === 'zz') return Response.json(fixture('president-zz'));
        // Same official structure for every state, under that state's code.
        return Response.json({ ...state, cdabr: uf });
      }),
    );
    vi.resetModules();
    delete (globalThis as { tseClient?: unknown }).tseClient;
    const { firstRound } = await import('../src/lib/tse/first-round');
    const result = await firstRound();
    expect(result.available).toBe(true);
    expect(result.national?.candidates).toHaveLength(12);
    expect(result.places).toHaveLength(27);
    expect(result.places.every((place) => place.snapshot)).toBe(true);
    expect(result.exterior?.snapshot).not.toBeNull();
    // Only 1st-round files were read: nothing from the 2nd round's election code.
    expect(requested.some((url) => url.includes('/6258/'))).toBe(false);
    expect(requested.filter((url) => url.includes('/6257/'))).toHaveLength(29);
  }, 30_000);
});
