#!/usr/bin/env node
/**
 * Chat demo against a real deployment: test accounts with a profile photo exchange messages and
 * stickers, to check the chat, the stickers and photo saving with traffic. Node 20+, no packages.
 *
 *   node scripts/chat-demo.mjs seed --bots 30                  > bots.sql   (accounts, for psql)
 *   node scripts/chat-demo.mjs run --base https://site --secret "$SESSION_SECRET" --minutes 10 [--photos 0.3]
 *   node scripts/chat-demo.mjs cleanup --bots 30 --secret "$SESSION_SECRET" > clean.sql
 *
 * Accounts have ids "bot:N" and usernames starting with "teste_", so nobody mistakes them for
 * real people, and cleanup removes them with their messages and photos.
 */
import { createHmac } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at > 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};
const BOTS = Math.min(Number(option('bots', 30)), 200);
const SECRET = option('secret', process.env.SESSION_SECRET);
const flushed = () => new Promise((resolve) => process.stdout.write('', resolve));

const NAMES = [
  'ana',
  'bruno',
  'carla',
  'diego',
  'elisa',
  'fabio',
  'gabi',
  'heitor',
  'iara',
  'joao',
  'karina',
  'lucas',
  'marina',
  'nina',
  'otavio',
  'paula',
  'rafa',
  'sofia',
  'tiago',
  'vera',
  'wesley',
  'yasmin',
  'zeca',
  'livia',
  'caio',
  'bia',
  'duda',
  'leo',
  'malu',
  'davi',
];
const bot = (i) => ({
  id: `bot:${i}`,
  username: `teste_${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}`,
  // Half PT (13), half PL (22): without a photo, the avatar shows the party number.
  party: ['PT', 'PL'][i % 2],
});
const photoKey = (id) =>
  createHmac('sha256', SECRET).update(`photo:${id}`).digest('hex').slice(0, 24);

if (command === 'seed') {
  const rows = Array.from({ length: BOTS }, (_, i) => {
    const b = bot(i);
    const consent = b.party === 'none' ? 'NULL' : 'now()';
    return `('${b.id}','${b.username}@example.invalid','${b.username}','${b.username}','${b.party}',${consent},now(),now(),'${b.id}',1000)`;
  });
  console.log(`INSERT INTO access_users (id,email,name,username,party,party_consent_at,onboarded_at,paid_at,session_id,sticker_credits) VALUES
${rows.join(',\n')}
ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, party=EXCLUDED.party,
  party_consent_at=EXCLUDED.party_consent_at, onboarded_at=now(), paid_at=now(),
  session_id=EXCLUDED.session_id, sticker_credits=1000, deleted_at=NULL, paused_at=NULL;`);
  await flushed();
  process.exit(0);
}

if (command === 'cleanup') {
  if (!SECRET) throw new Error('--secret is needed to find the bots photos.');
  const keys = Array.from({ length: BOTS }, (_, i) => `'${photoKey(bot(i).id)}'`).join(',');
  console.log(`BEGIN;
DELETE FROM chat_reports WHERE message_id IN (SELECT id FROM chat_messages WHERE user_id LIKE 'bot:%');
DELETE FROM chat_messages WHERE user_id LIKE 'bot:%';
DELETE FROM profile_photos WHERE key IN (${keys});
DELETE FROM access_payments WHERE user_id LIKE 'bot:%';
DELETE FROM access_users WHERE id LIKE 'bot:%';
COMMIT;`);
  await flushed();
  process.exit(0);
}

if (command !== 'run') {
  console.error('Usage: node scripts/chat-demo.mjs seed|run|cleanup [options]');
  process.exit(1);
}
if (!SECRET) throw new Error('--secret (the server SESSION_SECRET) is required.');
const BASE = option('base', 'http://127.0.0.1:3000').replace(/\/$/, '');
const MINUTES = Number(option('minutes', 10));
// Messages per second in the whole room (the room accepts up to 10).
const RATE = Number(option('rate', 1));
// Share of bots that upload a profile photo (0 to 1); the others keep the 13/22 avatar.
const PHOTOS = Number(option('photos', 0));

const cookieFor = (b) => {
  const payload = Buffer.from(
    JSON.stringify({
      sub: b.id,
      email: `${b.username}@example.invalid`,
      name: b.username,
      sid: b.id,
      exp: Math.floor(Date.now() / 1000) + 86_400,
    }),
  ).toString('base64url');
  return `rb_session=${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};

/** A 256×256 PNG: a colored background with a lighter disc, different for each bot. */
function avatar(i) {
  const size = 256;
  const hue = (i * 47) % 360;
  const rgb = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  };
  const back = rgb(hue, 0.55, 0.42),
    disc = rgb((hue + 30) % 360, 0.6, 0.72);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inDisc =
        (x - 128) ** 2 + (y - 110) ** 2 < 62 ** 2 ||
        (x - 128) ** 2 / 1.2 + (y - 250) ** 2 < 105 ** 2;
      const [r, g, b] = inDisc ? disc : back;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
// Phrases are assembled from parts so they rarely repeat: the chat refuses the same text twice
// from one person and a long text that someone else has just sent.
const OPENERS = [
  'Gente,',
  'Olha só:',
  'Atenção:',
  'Agora sim,',
  'Nossa,',
  'Pessoal,',
  'Eita,',
  'Vejam:',
  '',
];
const PLACES = [
  'São Paulo',
  'Minas',
  'Bahia',
  'Rio',
  'Paraná',
  'Pernambuco',
  'Ceará',
  'Goiás',
  'Pará',
  'Santa Catarina',
  'Rio Grande do Sul',
  'Amazonas',
  'Maranhão',
  'Espírito Santo',
  'o exterior',
];
const EVENTS = [
  'acabou de atualizar',
  'tá apertado',
  'virou agora',
  'subiu bastante',
  'ainda tá lento',
  'chegou a 80%',
  'passou da metade',
  'tá definido',
  'mudou de cor no mapa',
  'segue embolado',
];
const TAILS = ['', '!', '...', ' 👀', ' 😬', ' 🗳️', '?', ' hein', ' demais'];
const SHORT = [
  'Boa noite!',
  'Que nervoso',
  'Calma, gente',
  'Vamo que vamo',
  'Tô aqui',
  'Que noite',
  'Café na mão ☕',
];
const message = () =>
  Math.random() < 0.15
    ? pick(SHORT)
    : `${pick(OPENERS)} ${pick(PLACES)} ${pick(EVENTS)}${pick(TAILS)}`.trim();
// Only the PT (13) pack exists, and only PT bots may send it.
const STICKERS = [
  '13-o-pai-ta-on',
  '13-100-lula',
  '13-calma-conta-ate-13',
  '13-toma-aqui-tua-anistia',
  '13-coracao',
  '13-abraco-na-estrela',
  '13-lingua',
];

const bots = Array.from({ length: BOTS }, (_, i) => ({ ...bot(i), cookie: cookieFor(bot(i)) }));
const origin = new URL(BASE).origin;

const withPhoto = bots.filter((_, i) => i < Math.round(bots.length * PHOTOS));
console.log(`Enviando fotos de ${withPhoto.length} de ${bots.length} contas de teste…`);
let photos = 0;
for (const [i, b] of withPhoto.entries()) {
  const response = await fetch(`${BASE}/api/profile/photo`, {
    method: 'POST',
    headers: { cookie: b.cookie, origin, 'content-type': 'image/png' },
    body: avatar(i),
  });
  if (response.ok) photos++;
  else console.warn(`  ${b.username}: foto ${response.status} ${await response.text()}`);
}
console.log(
  `Fotos salvas: ${photos}/${withPhoto.length}. Conversa por ${MINUTES} min, ~${RATE} msg/s.`,
);

const stats = { text: 0, sticker: 0, slow: 0, full: 0, repeated: 0, other: 0 };
const ready = new Map(); // bot id -> time its slow mode ends
const until = Date.now() + MINUTES * 60_000;
const report = setInterval(
  () =>
    console.log(
      `textos ${stats.text} · figurinhas ${stats.sticker} · modo lento ${stats.slow} · sala cheia ${stats.full} · repetidas ${stats.repeated} · outros erros ${stats.other}`,
    ),
  15_000,
);
while (Date.now() < until) {
  const free = bots.filter((b) => (ready.get(b.id) ?? 0) <= Date.now());
  if (free.length) {
    const b = pick(free);
    const sticker = b.party === 'PT' && Math.random() < 0.3;
    const response = await fetch(`${BASE}/api/chat/messages`, {
      method: 'POST',
      headers: { cookie: b.cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify(sticker ? { sticker: pick(STICKERS) } : { text: message() }),
    });
    ready.set(b.id, Date.now() + 5_500);
    if (response.status === 201) stats[sticker ? 'sticker' : 'text']++;
    else if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      stats[/movimentado/.test(body.error ?? '') ? 'full' : 'slow']++;
    } else if (response.status === 409) {
      stats.repeated++;
    } else {
      stats.other++;
      if (stats.other <= 3) console.warn(`  erro ${response.status}: ${await response.text()}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, (1000 / RATE) * (0.5 + Math.random())));
}
clearInterval(report);
console.log(
  `Fim: ${stats.text} textos e ${stats.sticker} figurinhas enviados; modo lento ${stats.slow}, sala cheia ${stats.full}, outros erros ${stats.other}.`,
);
process.exit(0);
