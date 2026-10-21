#!/usr/bin/env node
/**
 * Load test against a real deployment: N logged-in people with the panel and the chat open.
 * See docs/LOAD_TEST.md. Only Node 20+; no dependencies.
 *
 *   node scripts/load-test.mjs seed --users 5000            > seed.sql   (SQL for the test accounts)
 *   node scripts/load-test.mjs run  --base https://site --users 5000 --secret $SESSION_SECRET
 *   node scripts/load-test.mjs cleanup                      > cleanup.sql
 *
 * Every test account has an id starting with "load:" and a username starting with "carga".
 */
import { createHmac } from 'node:crypto';

const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at > 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};
const USERS = Number(option('users', 5000));
const id = (i) => `load:${i}`;
// Exit only after everything printed reached the pipe (psql), or the SQL is cut short.
const flushed = () => new Promise((resolve) => process.stdout.write('', resolve));

if (command === 'seed') {
  // Paid, onboarded accounts with a known session id, so the signed cookie is accepted.
  const rows = [];
  for (let i = 0; i < USERS; i++)
    rows.push(
      `('${id(i)}','carga${i}@example.invalid','Carga ${i}','carga${i}',now(),now(),'load${i}')`,
    );
  console.log('BEGIN;');
  // Same table the app creates on first use (src/lib/access/store.ts), for a fresh database.
  console.log(`CREATE TABLE IF NOT EXISTS access_users (
  id text PRIMARY KEY, email text NOT NULL, name text NOT NULL,
  free_seconds_used double precision NOT NULL DEFAULT 0, last_seen_at timestamptz,
  paid_at timestamptz, payment_id text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE access_users
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS session_changes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS party text,
  ADD COLUMN IF NOT EXISTS party_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS photo_version bigint;`);
  for (let i = 0; i < rows.length; i += 1000)
    console.log(
      `INSERT INTO access_users (id,email,name,username,onboarded_at,paid_at,session_id) VALUES\n${rows
        .slice(i, i + 1000)
        .join(
          ',\n',
        )}\nON CONFLICT (id) DO UPDATE SET paid_at=now(), session_id=EXCLUDED.session_id, deleted_at=NULL, paused_at=NULL;`,
    );
  console.log('COMMIT;');
  await flushed();
  process.exit(0);
}

if (command === 'cleanup') {
  console.log(`BEGIN;
DELETE FROM chat_reports WHERE message_id IN (SELECT id FROM chat_messages WHERE user_id LIKE 'load:%');
DELETE FROM chat_messages WHERE user_id LIKE 'load:%';
DELETE FROM access_payments WHERE user_id LIKE 'load:%';
DELETE FROM access_users WHERE id LIKE 'load:%';
COMMIT;`);
  await flushed();
  process.exit(0);
}

if (command !== 'run') {
  console.error(
    'Usage: node scripts/load-test.mjs seed|run|cleanup [options] (see docs/LOAD_TEST.md)',
  );
  process.exit(1);
}

const BASE = option('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const SECRET = option('secret', process.env.SESSION_SECRET);
const RAMP_S = Number(option('ramp', 120));
const DURATION_S = Number(option('duration', 600));
const WRITERS = Number(option('writers', 0.2));
const MUNICIPAL = Number(option('municipal', 0.3));
const OFFSET = Number(option('offset', 0));
if (!SECRET) {
  console.error('--secret (the server SESSION_SECRET) is required to sign the test cookies.');
  process.exit(1);
}

const sign = (value, ttl = 86_400) => {
  const payload = Buffer.from(
    JSON.stringify({ ...value, exp: Math.floor(Date.now() / 1000) + ttl }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};

// --- Metrics, reset every report ---
const stats = {
  requests: new Map(),
  latency: new Map(),
  chatDelay: [],
  sent: 0,
  refused: 0,
  events: 0,
  bytes: 0,
};
let streamsOpen = 0,
  streamFailures = 0,
  people = 0;
const record = (name, status, ms) => {
  const key = `${name} ${status}`;
  stats.requests.set(key, (stats.requests.get(key) ?? 0) + 1);
  if (!stats.latency.has(name)) stats.latency.set(name, []);
  stats.latency.get(name).push(ms);
};
const pct = (list, p) => {
  if (!list.length) return '-';
  const sorted = [...list].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms) => ms * (0.8 + Math.random() * 0.4);
let running = true;

async function call(name, path, cookie, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(BASE + path, {
      ...init,
      headers: { cookie, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const body = response.status === 304 ? '' : await response.text();
    record(name, response.status, performance.now() - started);
    return { response, body };
  } catch (error) {
    record(name, error.name === 'TimeoutError' ? 'timeout' : 'error', performance.now() - started);
    return null;
  }
}

/** One person: chat stream, result polling (honoring X-Poll-After and ETag), heartbeat, messages. */
async function person(i) {
  const cookie = `rb_session=${sign({ sub: id(i), email: `carga${i}@example.invalid`, name: `Carga ${i}`, sid: `load${i}` })}`;
  people++;
  const loops = [];
  // Chat stream.
  loops.push(
    (async () => {
      while (running) {
        try {
          const response = await fetch(`${BASE}/api/chat/stream`, { headers: { cookie } });
          if (!response.ok) throw new Error(String(response.status));
          streamsOpen++;
          const decoder = new TextDecoder();
          try {
            for await (const chunk of response.body) {
              if (!running) break;
              stats.bytes += chunk.length;
              const text = decoder.decode(chunk, { stream: true });
              for (const match of text.matchAll(/"text":"carga (\d+)"/g)) {
                stats.events++;
                stats.chatDelay.push(Date.now() - Number(match[1]));
              }
            }
          } finally {
            streamsOpen--;
          }
        } catch {
          streamFailures++;
        }
        if (running) await sleep(jitter(3000));
      }
    })(),
  );
  // National results.
  loops.push(
    (async () => {
      let etag = '';
      while (running) {
        const result = await call('president', '/api/election/president', cookie, {
          headers: etag ? { 'if-none-match': etag } : {},
        });
        etag = result?.response.headers.get('etag') ?? etag;
        await sleep(
          jitter(Math.max(3000, Number(result?.response.headers.get('x-poll-after')) || 10_000)),
        );
      }
    })(),
  );
  // Map, every 20 s.
  loops.push(
    (async () => {
      let etag = '';
      await sleep(Math.random() * 20_000);
      while (running) {
        const result = await call('map', '/api/election/president/map', cookie, {
          headers: etag ? { 'if-none-match': etag } : {},
        });
        etag = result?.response.headers.get('etag') ?? etag;
        await sleep(jitter(20_000));
      }
    })(),
  );
  // Heartbeat, every 20 s.
  loops.push(
    (async () => {
      await sleep(Math.random() * 20_000);
      while (running) {
        await call('heartbeat', '/api/access', cookie, { method: 'POST' });
        await sleep(jitter(20_000));
      }
    })(),
  );
  // Some people follow one state's municipalities.
  if (Math.random() < MUNICIPAL)
    loops.push(
      (async () => {
        const uf = ['sp', 'mg', 'rj', 'ba', 'pr', 'rs', 'pe', 'ce'][i % 8];
        await sleep(Math.random() * 20_000);
        while (running) {
          await call('municipal', `/api/election/president/municipalities?state=${uf}`, cookie);
          await sleep(jitter(20_000));
        }
      })(),
    );
  // Some people write: every 5 to 60 s.
  if (Math.random() < WRITERS)
    loops.push(
      (async () => {
        while (running) {
          await sleep(5_000 + Math.random() * 55_000);
          if (!running) break;
          const result = await call('chat-post', '/api/chat/messages', cookie, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: `carga ${Date.now()}` }),
          });
          if (result?.response.ok) stats.sent++;
          else stats.refused++;
        }
      })(),
    );
  await Promise.allSettled(loops);
}

function report() {
  const lines = [];
  const total = [...stats.requests.values()].reduce((a, b) => a + b, 0);
  lines.push(
    `\n[${new Date().toISOString().slice(11, 19)}] pessoas ${people} | chat aberto ${streamsOpen} | falhas de stream ${streamFailures} | ${(total / 10).toFixed(0)} req/s`,
  );
  for (const [name, list] of stats.latency) {
    const statuses = [...stats.requests]
      .filter(([key]) => key.startsWith(name + ' '))
      .map(([key, n]) => `${key.slice(name.length + 1)}:${n}`)
      .join(' ');
    lines.push(
      `  ${name.padEnd(10)} p50 ${pct(list, 50)}ms  p95 ${pct(list, 95)}ms  p99 ${pct(list, 99)}ms  [${statuses}]`,
    );
  }
  lines.push(
    `  chat: enviadas ${stats.sent}, recusadas ${stats.refused}, entregas ${stats.events} (${(stats.bytes / 10 / 1e6).toFixed(1)} MB/s), atraso p50 ${pct(stats.chatDelay, 50)}ms p95 ${pct(stats.chatDelay, 95)}ms`,
  );
  console.log(lines.join('\n'));
  stats.requests.clear();
  stats.latency.clear();
  stats.chatDelay = [];
  stats.sent = stats.refused = stats.events = stats.bytes = 0;
}

console.log(
  `Teste de carga: ${USERS} pessoas em ${BASE}, subindo em ${RAMP_S}s, por ${DURATION_S}s.`,
);
const timer = setInterval(report, 10_000);
// Hard stop even if this generator is overloaded and the normal ending is late.
setTimeout(() => process.exit(0), (DURATION_S + 30) * 1000);
const all = [];
for (let i = 0; i < USERS; i++) {
  all.push(person(OFFSET + i));
  await sleep((RAMP_S * 1000) / USERS);
}
await sleep(Math.max(0, DURATION_S * 1000 - RAMP_S * 1000));
running = false;
console.log('\nEncerrando…');
setTimeout(() => process.exit(0), 5_000);
await Promise.allSettled(all);
clearInterval(timer);
report();
process.exit(0);
