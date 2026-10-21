import { createHash, randomBytes } from 'node:crypto';
import { MemoryChatBus, RedisChatBus } from './bus';
import { stickerById } from './stickers';
import { MemoryChatStore, PostgresChatStore } from './store';
import { cleanMessage, SLOW_MODE_MS } from './text';
import {
  toPublic,
  type ChatBus,
  type ChatEvent,
  type ChatStore,
  type PublicMessage,
} from './types';

/** Messages a newly connected panel receives. */
export const HISTORY_SIZE = 100;
const ONLINE_CACHE_MS = 5_000;
/** Messages the whole room accepts per second, across servers; beyond it the sender waits. */
export const ROOM_PER_SECOND = 10;
/** The same person cannot send the same text again within this window. */
export const REPEAT_OWN_MS = 10 * 60_000;
/** A text this long, just sent by anyone, cannot be sent again within REPEAT_ROOM_MS. */
export const REPEAT_ROOM_MIN_LENGTH = 20;
export const REPEAT_ROOM_MS = 2 * 60_000;
/** Live events are grouped and encoded once per interval for every open connection. */
export const BATCH_MS = 1_500;

export type ChatRuntime = {
  bus: ChatBus;
  store: ChatStore;
  /** This server's copy of the latest messages, kept current through the bus. */
  history: Promise<PublicMessage[]> | null;
  /** Whether this server already follows the bus to keep `history` current. */
  tracking?: boolean;
  connections: number;
  online: { at: number; value: Promise<number> } | null;
  /** Open streams fed with pre-encoded batches (see `connectStream`). */
  streams?: { sinks: Set<(chunk: Uint8Array) => void>; queue: ChatEvent[] };
};

const runtime = globalThis as { __chat?: ChatRuntime };

/**
 * Redis/Valkey (REDIS_URL) and Postgres (DATABASE_URL) in production; memory otherwise.
 * One instance per server process.
 */
export function chat(
  init: () => Pick<ChatRuntime, 'bus' | 'store'> = () => ({
    bus: process.env.REDIS_URL ? new RedisChatBus(process.env.REDIS_URL) : new MemoryChatBus(),
    store: process.env.DATABASE_URL
      ? new PostgresChatStore(process.env.DATABASE_URL)
      : new MemoryChatStore(),
  }),
): ChatRuntime {
  if (runtime.__chat) return runtime.__chat;
  const state: ChatRuntime = { ...init(), history: null, connections: 0, online: null };
  runtime.__chat = state;
  return state;
}

/** For tests: forget the process-wide instance. */
export const resetChat = () => delete runtime.__chat;

function apply(list: PublicMessage[], event: ChatEvent) {
  if (event.type === 'delete') return list.filter((message) => message.id !== event.id);
  if (list.some((message) => message.id === event.message.id)) return list;
  return [...list, event.message].slice(-HISTORY_SIZE);
}

export function history(state = chat()) {
  if (!state.tracking) {
    state.tracking = true;
    state.bus.subscribe((event) => {
      if (state.history) state.history = state.history.then((list) => apply(list, event));
    });
  }
  state.history ??= state.store
    .recent(HISTORY_SIZE)
    .then((messages) => messages.map(toPublic))
    .catch((error) => {
      state.history = null;
      throw error;
    });
  return state.history;
}

export type Author = {
  userId: string;
  username: string;
  party: string | null;
  /** Profile photo ("key.version"), or null. */
  photo: string | null;
};

export type SendResult =
  | { ok: true; message: PublicMessage }
  | { ok: false; status: number; error: string; retryAfterMs?: number; code?: string };

export async function sendMessage(
  author: Author,
  raw: unknown,
  state = chat(),
  now = Date.now(),
): Promise<SendResult> {
  const cleaned = cleanMessage(raw);
  if ('error' in cleaned) return { ok: false, status: 400, error: cleaned.error };
  return post(author, { text: cleaned.text, sticker: null }, state, now);
}

/**
 * Sends a sticker; same slow mode as text. `charge` spends one from the sender's packs and runs
 * only after every other check passed, so a refused sticker costs nothing.
 */
export async function sendSticker(
  author: Author,
  id: unknown,
  state = chat(),
  now = Date.now(),
  charge?: () => Promise<boolean>,
): Promise<SendResult> {
  const sticker = typeof id === 'string' ? stickerById(id) : null;
  if (!sticker) return { ok: false, status: 400, error: 'Figurinha indisponível.' };
  return post(author, { text: sticker.text, sticker: sticker.id }, state, now, charge);
}

async function post(
  author: Author,
  content: { text: string; sticker: string | null },
  state: ChatRuntime,
  now: number,
  charge?: () => Promise<boolean>,
): Promise<SendResult> {
  if (!(await state.bus.claim(`slow:${author.userId}`, SLOW_MODE_MS)))
    return {
      ok: false,
      status: 429,
      error: 'Modo lento: espere alguns segundos para mandar outra mensagem.',
      retryAfterMs: SLOW_MODE_MS,
    };
  if (!(await roomSlot(state, now)))
    return {
      ok: false,
      status: 429,
      error: 'O chat está muito movimentado. Tente de novo em alguns segundos.',
      retryAfterMs: SLOW_MODE_MS,
    };
  if (!content.sticker) {
    const repeated = await repeatedText(state, author.userId, content.text);
    if (repeated) return { ok: false, status: 409, error: repeated };
  }
  if (charge && !(await charge()))
    return {
      ok: false,
      status: 402,
      code: 'no_stickers',
      error: 'Suas figurinhas acabaram. Compre um pacote para enviar mais.',
    };
  const message = {
    id: now.toString(36) + randomBytes(6).toString('hex'),
    ...author,
    ...content,
    createdAt: now,
    deletedAt: null,
  };
  await state.store.add(message);
  const published = toPublic(message);
  await state.bus.publish({ type: 'message', message: published });
  return { ok: true, message: published };
}

/** Same text with case, accents, punctuation and spacing ignored. */
const textKey = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * No copy-and-paste in the chat: the same person repeating a text, or a long text that someone
 * else has just sent (shared through the bus, so it holds across servers). Returns the reason.
 */
async function repeatedText(state: ChatRuntime, userId: string, text: string) {
  const key = textKey(text);
  if (!key) return null;
  const hash = createHash('sha256').update(key).digest('base64url').slice(0, 22);
  if (!(await state.bus.claim(`repeat:own:${userId}:${hash}`, REPEAT_OWN_MS)))
    return 'Você já enviou essa mensagem. Escreva algo diferente.';
  if (
    key.length >= REPEAT_ROOM_MIN_LENGTH &&
    !(await state.bus.claim(`repeat:room:${hash}`, REPEAT_ROOM_MS))
  )
    return 'Essa mensagem acabou de ser enviada no chat. Escreva com suas palavras.';
  return null;
}

/** One of the room's ROOM_PER_SECOND slots for the current second (shared through the bus). */
async function roomSlot(state: ChatRuntime, now: number) {
  const second = Math.floor(now / 1000);
  for (let slot = 0; slot < ROOM_PER_SECOND; slot++)
    if (await state.bus.claim(`room:${second}:${slot}`, 2_000)) return true;
  return false;
}

/** Removes a message for everyone (moderation). */
export async function deleteMessage(id: string, by: string, state = chat(), now = Date.now()) {
  const removed = await state.store.remove(id, by, now);
  if (removed) await state.bus.publish({ type: 'delete', id });
  return removed;
}

/** Removes all of an author's messages for everyone (account deleted). */
export async function deleteMessagesBy(
  userId: string,
  by: string,
  state = chat(),
  now = Date.now(),
) {
  const ids = await state.store.removeByAuthor(userId, by, now);
  for (const id of ids) await state.bus.publish({ type: 'delete', id });
  return ids.length;
}

export async function reportMessage(id: string, userId: string, state = chat(), now = Date.now()) {
  if (!(await state.store.get(id))) return 'missing' as const;
  return (await state.store.report(id, userId, now)) ? ('ok' as const) : ('already' as const);
}

/** Registers a live connection; call the returned function when it closes. */
export function connect(listener: (event: ChatEvent) => void, state = chat()) {
  state.connections += 1;
  const unsubscribe = state.bus.subscribe(listener);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    state.connections -= 1;
    unsubscribe();
  };
}

export const encodeEvent = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Registers a live Server-Sent Events connection. Instead of one listener per connection, the
 * server queues bus events and every BATCH_MS encodes them once and hands the same bytes to all
 * open streams, so a message costs one JSON encoding however many people are watching.
 */
export function connectStream(sink: (chunk: Uint8Array) => void, state = chat()) {
  if (!state.streams) {
    const streams = (state.streams = {
      sinks: new Set<(chunk: Uint8Array) => void>(),
      queue: [] as ChatEvent[],
    });
    const encoder = new TextEncoder();
    state.bus.subscribe((event) => streams.queue.push(event));
    setInterval(() => {
      if (!streams.queue.length) return;
      const events = streams.queue.splice(0);
      if (!streams.sinks.size) return;
      const chunk = encoder.encode(events.map((event) => encodeEvent(event.type, event)).join(''));
      for (const send of streams.sinks) send(chunk);
    }, BATCH_MS).unref?.();
  }
  const { sinks } = state.streams;
  state.connections += 1;
  sinks.add(sink);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    state.connections -= 1;
    sinks.delete(sink);
  };
}

/** People with the chat open across all servers (cached for a few seconds). */
export function onlineCount(state = chat(), now = Date.now()) {
  if (!state.online || now - state.online.at > ONLINE_CACHE_MS)
    state.online = {
      at: now,
      value: state.bus.online(state.connections).catch(() => state.connections),
    };
  return state.online.value;
}
