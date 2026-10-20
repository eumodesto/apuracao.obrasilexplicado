import { randomBytes } from 'node:crypto';
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

export type ChatRuntime = {
  bus: ChatBus;
  store: ChatStore;
  /** This server's copy of the latest messages, kept current through the bus. */
  history: Promise<PublicMessage[]> | null;
  /** Whether this server already follows the bus to keep `history` current. */
  tracking?: boolean;
  connections: number;
  online: { at: number; value: Promise<number> } | null;
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
  | { ok: false; status: number; error: string; retryAfterMs?: number };

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

/** Sends a sticker from the available packs; same slow mode as text. */
export async function sendSticker(
  author: Author,
  id: unknown,
  state = chat(),
  now = Date.now(),
): Promise<SendResult> {
  const sticker = typeof id === 'string' ? stickerById(id) : null;
  if (!sticker) return { ok: false, status: 400, error: 'Figurinha indisponível.' };
  return post(author, { text: sticker.text, sticker: sticker.id }, state, now);
}

async function post(
  author: Author,
  content: { text: string; sticker: string | null },
  state: ChatRuntime,
  now: number,
): Promise<SendResult> {
  if (!(await state.bus.claim(`slow:${author.userId}`, SLOW_MODE_MS)))
    return {
      ok: false,
      status: 429,
      error: 'Modo lento: espere alguns segundos para mandar outra mensagem.',
      retryAfterMs: SLOW_MODE_MS,
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

/** People with the chat open across all servers (cached for a few seconds). */
export function onlineCount(state = chat(), now = Date.now()) {
  if (!state.online || now - state.online.at > ONLINE_CACHE_MS)
    state.online = {
      at: now,
      value: state.bus.online(state.connections).catch(() => state.connections),
    };
  return state.online.value;
}
