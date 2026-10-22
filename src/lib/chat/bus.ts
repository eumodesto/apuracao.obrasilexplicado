import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { ChatBus, ChatEvent, PartyCounts } from './types';

/** Single-process bus: enough for `npm run dev` and one server. */
export class MemoryChatBus implements ChatBus {
  private listeners = new Set<(event: ChatEvent) => void>();
  private slots = new Map<string, number>();

  async publish(event: ChatEvent) {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: ChatEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async claim(key: string, ms: number, now = Date.now()) {
    if ((this.slots.get(key) ?? 0) > now) return false;
    if (this.slots.size > 100_000)
      for (const [slot, until] of this.slots) if (until <= now) this.slots.delete(slot);
    this.slots.set(key, now + ms);
    return true;
  }

  async online(local: number) {
    return local;
  }

  async partyOnline(local: PartyCounts) {
    return { ...local };
  }
}

const CHANNEL = 'chat:events';
const ONLINE_PREFIX = 'chat:online:';
const PARTY_PREFIX = 'chat:parties:';
const ONLINE_TTL_SECONDS = 30;

/**
 * Redis/Valkey bus for several servers behind the load balancer: events go through pub/sub,
 * slow mode uses SET NX PX, and each server reports its connection count under its own key.
 */
export class RedisChatBus implements ChatBus {
  private publisher: Redis;
  private subscriber: Redis;
  private listeners = new Set<(event: ChatEvent) => void>();
  private serverId = randomUUID();

  constructor(url: string) {
    this.publisher = new Redis(url, { maxRetriesPerRequest: 2 });
    this.subscriber = new Redis(url);
    this.subscriber.subscribe(CHANNEL).catch((error) => {
      console.error('[chat] Redis subscribe failed', error);
    });
    this.subscriber.on('message', (_channel, payload) => {
      let event: ChatEvent;
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(event);
    });
  }

  async publish(event: ChatEvent) {
    await this.publisher.publish(CHANNEL, JSON.stringify(event));
  }

  subscribe(listener: (event: ChatEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async claim(key: string, ms: number) {
    return (await this.publisher.set(`chat:slot:${key}`, '1', 'PX', ms, 'NX')) === 'OK';
  }

  async online(local: number) {
    await this.publisher.set(
      ONLINE_PREFIX + this.serverId,
      String(local),
      'EX',
      ONLINE_TTL_SECONDS,
    );
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.publisher.scan(
        cursor,
        'MATCH',
        `${ONLINE_PREFIX}*`,
        'COUNT',
        100,
      );
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    const counts = keys.length ? await this.publisher.mget(keys) : [];
    return counts.reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  async partyOnline(local: PartyCounts) {
    await this.publisher.set(
      PARTY_PREFIX + this.serverId,
      JSON.stringify(local),
      'EX',
      ONLINE_TTL_SECONDS,
    );
    const keys = await this.keys(PARTY_PREFIX);
    const total: PartyCounts = { PT: 0, PL: 0, other: 0 };
    for (const value of keys.length ? await this.publisher.mget(keys) : []) {
      try {
        const counts = JSON.parse(value ?? '{}') as Partial<PartyCounts>;
        for (const key of ['PT', 'PL', 'other'] as const) total[key] += Number(counts[key]) || 0;
      } catch {
        // A broken entry expires on its own.
      }
    }
    return total;
  }

  private async keys(prefix: string) {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.publisher.scan(cursor, 'MATCH', prefix + '*', 'COUNT', 100);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    return keys;
  }

  async close() {
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }
}
