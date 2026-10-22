import { afterAll, describe, expect, it, vi } from 'vitest';
import { MemoryChatBus, RedisChatBus } from '../src/lib/chat/bus';
import {
  type ChatRuntime,
  BATCH_MS,
  connect,
  connectStream,
  deleteMessage,
  history,
  onlineCount,
  reportMessage,
  ROOM_PER_SECOND,
  sendMessage,
  sendSticker,
} from '../src/lib/chat/service';
import { MemoryChatStore, PostgresChatStore } from '../src/lib/chat/store';
import { cleanMessage, maskInsults, SLOW_MODE_MS } from '../src/lib/chat/text';
import type { ChatBus, ChatEvent, ChatMessage, ChatStore } from '../src/lib/chat/types';

const T0 = Date.parse('2026-10-25T19:00:00-03:00');
const ana = { userId: 'google:ana', username: 'ana', party: 'PT', photo: null };
const bia = { userId: 'google:bia', username: 'bia', party: 'PL', photo: null };

/** A fresh chat instance, like one server process. */
const instance = (
  bus: ChatBus = new MemoryChatBus(),
  store: ChatStore = new MemoryChatStore(),
): ChatRuntime => ({ bus, store, history: null, connections: 0, online: null });

describe('message text', () => {
  it('keeps one clean line within the size limit', () => {
    expect(cleanMessage('  Virou!\n\n  Agora   vai  ')).toEqual({ text: 'Virou! Agora vai' });
    const long = 'apuração '.repeat(40).slice(0, 280);
    expect(cleanMessage(long)).toEqual({ text: long.trim() });
    expect(cleanMessage(long + 'x')).toHaveProperty('error');
    expect(cleanMessage('   ')).toHaveProperty('error');
    expect(cleanMessage(42)).toHaveProperty('error');
    // Zero-width and direction-override characters are removed.
    expect(cleanMessage(`ol${String.fromCharCode(0x200b)}á${String.fromCharCode(0x202e)}`)).toEqual(
      {
        text: 'ol á',
      },
    );
  });

  it('refuses links and flooding', () => {
    for (const text of [
      'veja https://exemplo.com',
      'acessa www.golpe.net',
      'entra no grupo.com.br',
      'chama no wa.me/5511999999999',
      'canal t.me/fake',
      'kkkkkkkkkkkkkkk',
    ])
      expect(cleanMessage(text), text).toHaveProperty('error');
    for (const text of ['13 na frente!', '22 virou em SP', 'apuração em 87,5%', 'ok... calma'])
      expect(cleanMessage(text), text).not.toHaveProperty('error');
  });

  it('masks insults as whole words only', () => {
    expect(maskInsults('Que MERDA de virada, otário!')).toBe('Que ***** de virada, ******!');
    expect(maskInsults('disputa apertada no computador')).toBe('disputa apertada no computador');
  });
});

describe('chat service (one server)', () => {
  it('delivers messages to connections and keeps the latest history', async () => {
    const state = instance();
    const events: ChatEvent[] = [];
    const close = connect((event) => events.push(event), state);
    expect(await history(state)).toEqual([]);
    const sent = await sendMessage(ana, 'Começou!', state, T0);
    expect(sent).toMatchObject({
      ok: true,
      message: { username: 'ana', party: 'PT', text: 'Começou!' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'message', message: { text: 'Começou!' } });
    // The public message never carries the account id.
    expect(JSON.stringify(events[0])).not.toContain('google:');
    expect((await history(state)).map((m) => m.text)).toEqual(['Começou!']);
    expect(await onlineCount(state, T0)).toBe(1);
    close();
    expect(await onlineCount(state, T0 + 60_000)).toBe(0);
  });

  it('applies slow mode per person', async () => {
    const state = instance();
    expect((await sendMessage(ana, 'um', state, T0)).ok).toBe(true);
    const again = await sendMessage(ana, 'dois', state, T0 + 1_000);
    expect(again).toMatchObject({ ok: false, status: 429, retryAfterMs: SLOW_MODE_MS });
    // Another person is not affected.
    expect((await sendMessage(bia, 'oi', state, T0 + 1_000)).ok).toBe(true);
  });

  it('does not spend the slow-mode slot on an invalid message', async () => {
    const state = instance();
    expect(await sendMessage(ana, 'www.spam.com', state, T0)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect((await sendMessage(ana, 'agora sim', state, T0)).ok).toBe(true);
  });

  it('removes a deleted message for everyone and accepts one report per person', async () => {
    const state = instance();
    const events: ChatEvent[] = [];
    connect((event) => events.push(event), state);
    const sent = await sendMessage(ana, 'mensagem ruim', state, T0);
    if (!sent.ok) throw new Error('send failed');
    await history(state);
    expect(await reportMessage(sent.message.id, bia.userId, state)).toBe('ok');
    expect(await reportMessage(sent.message.id, bia.userId, state)).toBe('already');
    expect(await reportMessage('nao-existe', bia.userId, state)).toBe('missing');
    expect(await deleteMessage(sent.message.id, 'admin', state)).toBe(true);
    expect(await deleteMessage(sent.message.id, 'admin', state)).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'delete', id: sent.message.id });
    expect(await history(state)).toEqual([]);
  });
});

const REDIS = process.env.TEST_REDIS_URL;
describe.skipIf(!REDIS)('chat across servers (Redis)', () => {
  const buses: RedisChatBus[] = [];
  afterAll(async () => {
    await Promise.all(buses.map((bus) => bus.close()));
  });

  it('fans messages out to every server, shares slow mode and sums who is online', async () => {
    const store = new MemoryChatStore();
    const one = new RedisChatBus(REDIS!),
      two = new RedisChatBus(REDIS!);
    buses.push(one, two);
    const serverOne = instance(one, store),
      serverTwo = instance(two, store);
    const received: ChatEvent[] = [];
    connect((event) => received.push(event), serverTwo);
    connect(() => {}, serverOne);
    connect(() => {}, serverOne);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const user = { ...ana, userId: `redis:${Date.now()}` };
    expect((await sendMessage(user, 'de um servidor para o outro', serverOne, T0)).ok).toBe(true);
    await expect.poll(() => received.length).toBe(1);
    expect(received[0]).toMatchObject({ message: { text: 'de um servidor para o outro' } });
    // The same person on the other server is still in slow mode.
    expect(await sendMessage(user, 'de novo', serverTwo, T0)).toMatchObject({ status: 429 });

    await onlineCount(serverOne, T0);
    expect(await onlineCount(serverTwo, T0)).toBeGreaterThanOrEqual(3);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('chat history in Postgres', () => {
  it('stores, lists, deletes and reports messages', async () => {
    const store = new PostgresChatStore(process.env.TEST_DATABASE_URL!);
    const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const message = (n: number): ChatMessage => ({
      id: `${run}x${n}`,
      userId: 'google:pg',
      username: 'pg',
      party: null,
      photo: null,
      sticker: null,
      text: `mensagem ${n}`,
      // Far in the future and later on every run, so these are the most recent rows.
      createdAt: Date.parse('2100-01-01T00:00:00Z') + Date.now() * 10 + n,
      deletedAt: null,
    });
    for (const n of [1, 2, 3]) await store.add(message(n));
    expect((await store.recent(3)).map((m) => m.text)).toEqual([
      'mensagem 1',
      'mensagem 2',
      'mensagem 3',
    ]);
    expect(await store.remove(`${run}x2`, 'admin', T0)).toBe(true);
    expect(await store.remove(`${run}x2`, 'admin', T0)).toBe(false);
    expect((await store.recent(2)).map((m) => m.text)).toEqual(['mensagem 1', 'mensagem 3']);
    expect(await store.report(`${run}x1`, 'google:bia', T0)).toBe(true);
    expect(await store.report(`${run}x1`, 'google:bia', T0)).toBe(false);
    expect((await store.get(`${run}x2`))?.deletedAt).toBe(T0);
  });
});

describe('chat under load', () => {
  it('accepts at most ROOM_PER_SECOND messages per second in the whole room', async () => {
    const state = instance();
    const people = Array.from({ length: ROOM_PER_SECOND + 3 }, (_, i) => ({
      ...ana,
      userId: `google:p${i}`,
      username: `p${i}`,
    }));
    const results = [];
    for (const person of people) results.push(await sendMessage(person, 'Virou!', state, T0));
    expect(results.filter((r) => r.ok)).toHaveLength(ROOM_PER_SECOND);
    expect(results.at(-1)).toMatchObject({ ok: false, status: 429 });
    // The next second opens the room again (bia has not used the slow-mode turn yet).
    expect(await sendMessage(bia, 'Agora foi', state, T0 + 1_000)).toMatchObject({
      ok: true,
    });
  });

  it('sends the same encoded batch to every open stream', async () => {
    vi.useFakeTimers();
    try {
      const state = instance();
      const chunks: Uint8Array[][] = [[], []];
      const closers = chunks.map((list) => connectStream((chunk) => list.push(chunk), state));
      expect(state.connections).toBe(2);
      await sendMessage(ana, 'Um', state, T0);
      await sendMessage(bia, 'Dois', state, T0);
      expect(chunks[0]).toHaveLength(0);
      vi.advanceTimersByTime(BATCH_MS);
      expect(chunks[0]).toHaveLength(1);
      expect(chunks[1][0]).toBe(chunks[0][0]);
      const text = new TextDecoder().decode(chunks[0][0]);
      expect(text.match(/^event: message$/gm)).toHaveLength(2);
      expect(text).toContain('"text":"Um"');
      closers.forEach((close) => close());
      expect(state.connections).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('no copy-and-paste in the chat', () => {
  /** Slow mode runs on the real clock; these tests only look at repeated texts. */
  class NoSlowBus extends MemoryChatBus {
    async claim(key: string, ms: number) {
      return key.startsWith('slow:') ? true : super.claim(key, ms);
    }
  }
  it('refuses the same person repeating a text, even with other case, accents or spacing', async () => {
    const state = instance(new NoSlowBus());
    expect(await sendMessage(ana, 'Virou em Minas!', state, T0)).toMatchObject({ ok: true });
    expect(await sendMessage(ana, '  virou em  MINAS ', state, T0 + 6_000)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await sendMessage(ana, 'Agora virou de vez', state, T0 + 12_000)).toMatchObject({
      ok: true,
    });
    // Stickers can repeat.
    expect(await sendSticker(ana, '13-lingua', state, T0 + 18_000)).toMatchObject({ ok: true });
    expect(await sendSticker(ana, '13-lingua', state, T0 + 24_000)).toMatchObject({ ok: true });
  });

  it('refuses a long text another account has just sent, but not a short one', async () => {
    const state = instance(new NoSlowBus());
    const long = 'Contagem de votos em São Paulo acelerou agora';
    expect(await sendMessage(ana, long, state, T0)).toMatchObject({ ok: true });
    expect(await sendMessage(bia, long.toUpperCase(), state, T0 + 1_000)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await sendMessage(ana, 'Vai 13', state, T0 + 6_000)).toMatchObject({ ok: true });
    expect(await sendMessage(bia, 'vai 13', state, T0 + 7_000)).toMatchObject({ ok: true });
  });
});

describe('party sticker packs', () => {
  it('lets only the party send its pack, and shows it as a picture sticker', async () => {
    const { STICKERS, canUseSticker } = await import('../src/lib/chat/stickers');
    const pack = STICKERS.filter((sticker) => sticker.party === 'PT');
    expect(pack).toHaveLength(7);
    expect(pack.every((sticker) => sticker.image?.startsWith('/stickers/13/'))).toBe(true);
    expect(canUseSticker(pack[0], 'PT')).toBe(true);
    expect(canUseSticker(pack[0], 'PL')).toBe(false);
    expect(canUseSticker(pack[0], null)).toBe(false);
    // The emoji examples are gone: other parties and "none" have no stickers yet.
    expect(STICKERS.every((sticker) => sticker.party === 'PT')).toBe(true);
    const state = instance();
    expect(await sendSticker(ana, '13-lingua', state, T0)).toMatchObject({ ok: true });
    expect(await sendSticker(bia, '13-lingua', state, T0)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('keeps every pack picture in public/stickers', async () => {
    const { existsSync } = await import('node:fs');
    const { STICKERS } = await import('../src/lib/chat/stickers');
    for (const sticker of STICKERS.filter((s) => s.image))
      expect(existsSync(`public${sticker.image}`), sticker.image).toBe(true);
  });
});
