import { readFileSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { discoverElection } from '../src/lib/tse/config';
import { normalizeResult } from '../src/lib/tse/normalizers';
import { validVoteAnalysis } from '../src/lib/tse/analysis';
import { ElectionHistory } from '../src/lib/tse/history';
import { buildMapSnapshot, CandidateColors } from '../src/lib/tse/map-normalizers';
import { MemoryCache } from '../src/lib/tse/cache';
import { TseClient } from '../src/lib/tse/client';
const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const config = discoverElection(fixture('ele-c'));
function snapshot(percentage = 50.74) {
  const s = normalizeResult(
    fixture('president-br'),
    config,
    { type: 'country', code: 'br', state: 'br', name: 'Brasil' },
    'https://resultados.tse.jus.br',
  );
  s.status = 'counting';
  s.progress.validVotes = 10000;
  s.progress.percentageCounted = 20;
  s.progress.eligibleVoters = 200000;
  s.candidates = s.candidates.slice(0, 2).map((c, i) => ({
    ...c,
    votes: i ? 10000 - Math.round(percentage * 100) : Math.round(percentage * 100),
    destination: 'Válido',
    percentage: 1,
  }));
  return s;
}
describe('Presidential editorial analysis and observed history', () => {
  it.each([
    [50.74, 0.74],
    [48.4, -1.6],
    [50, 0],
  ])(
    'computes %s valid percent independently of official candidate denominator',
    (value, distance) => {
      const analysis = validVoteAnalysis(snapshot(value))!;
      const candidate = analysis.candidates.find((c) => c.id === snapshot(value).candidates[0].id)!;
      expect(candidate.percentage - 50).toBeCloseTo(distance);
      expect(candidate.percentage).not.toBe(1);
    },
  );
  it('does not infer a valid majority from zero, unknown destination, annulled or inconsistent votes', () => {
    const s = snapshot();
    s.candidates[0].destination = null;
    expect(validVoteAnalysis(s)).toBeNull();
    s.candidates[0].destination = 'Anulado';
    expect(validVoteAnalysis(s)).toBeNull();
    s.candidates[0].destination = 'Válido';
    s.progress.validVotes = 0;
    expect(validVoteAnalysis(s)).toBeNull();
    expect(validVoteAnalysis(null)).toBeNull();
  });
  it('regional electorate weight uses eligible electorate including national exterior, not counted votes', () => {
    const national = snapshot();
    const state = snapshot();
    state.progress.eligibleVoters = 40000;
    const result = buildMapSnapshot(
      [
        {
          uf: 'pb',
          name: 'Paraíba',
          region: 'Nordeste',
          snapshot: state,
          stale: false,
          issue: null,
        },
      ],
      national,
      new CandidateColors(),
    );
    expect(result.regions.find((r) => r.name === 'Nordeste')?.electorateWeight).toBe(20);
    expect(result.states[0].validVotes).toBe(10000);
  });
  it('persists real observations, coalesces duplicates, ignores clock-only updates and restores after restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'electoral-history-'));
    try {
      const history = new ElectionHistory(directory);
      const s = snapshot();
      const retrieved = '2026-10-04T20:00:00Z';
      await Promise.all(Array.from({ length: 10 }, () => history.record(s, retrieved)));
      const unchanged = structuredClone(s);
      unchanged.version = 'clock-only';
      unchanged.progress.generatedAt = '2026-10-04T18:01:00-03:00';
      await history.record(unchanged, retrieved);
      expect((await history.read()).observations).toHaveLength(1);
      const next = snapshot(51);
      next.version = 'new-votes';
      next.progress.totaledAt = '2026-10-04T18:02:00-03:00';
      await history.record(next, retrieved);
      const restored = await new ElectionHistory(directory).read();
      expect(restored.observations).toHaveLength(2);
      expect(restored.observations[1].candidates[0].percentage).toBe(51);
      expect(
        (await readFile(path.join(directory, 'president-history.jsonl'), 'utf8'))
          .trim()
          .split('\n'),
      ).toHaveLength(2);
      const municipal = structuredClone(next);
      municipal.version = 'municipal';
      municipal.scope.type = 'municipality';
      await history.record(municipal, retrieved);
      expect((await history.read()).observations).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('separates attemptedAt and successful checkedAt, preserving snapshot on failure and 304', async () => {
    let now = 10000;
    const responses = [
      new Response('{"votes":10}', { headers: { etag: '"one"' } }),
      new Response(null, { status: 500 }),
      new Response(null, { status: 304 }),
    ];
    const client = new TseClient(
      new MemoryCache(),
      async () => responses.shift()!,
      () => now,
      0,
    );
    const url = 'https://resultados.tse.jus.br/oficial/test.json';
    const parse = (r: unknown) => r;
    const first = await client.read(url, parse, 3000);
    now = 14000;
    const error = await client.read(url, parse, 3000);
    expect(error.checkedAt).toBe(first.checkedAt);
    expect(error.attemptedAt).toBe(14000);
    expect(error.value).toBe(first.value);
    now = 30000;
    const unchanged = await client.read(url, parse, 3000);
    expect(unchanged.value).toBe(first.value);
    expect(unchanged.checkedAt).toBe(30000);
    expect(unchanged.attemptedAt).toBe(30000);
  });
});
