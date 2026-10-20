import postgres from 'postgres';
import type { ChatMessage, ChatStore } from './types';

/** In-process store for local development and tests: the history lives while the server runs. */
export class MemoryChatStore implements ChatStore {
  private messages: ChatMessage[] = [];
  private reports = new Set<string>();

  async add(message: ChatMessage) {
    this.messages.push({ ...message });
    // Only the recent part is ever shown; keep memory bounded.
    if (this.messages.length > 2_000) this.messages = this.messages.slice(-1_000);
  }

  async recent(limit: number) {
    return this.messages
      .filter((message) => message.deletedAt === null)
      .slice(-limit)
      .map((message) => ({ ...message }));
  }

  async get(id: string) {
    const message = this.messages.find((item) => item.id === id);
    return message ? { ...message } : null;
  }

  async remove(id: string, _by: string, at: number) {
    const message = this.messages.find((item) => item.id === id);
    if (!message || message.deletedAt !== null) return false;
    message.deletedAt = at;
    return true;
  }

  async report(messageId: string, userId: string) {
    const key = `${messageId}|${userId}`;
    if (this.reports.has(key)) return false;
    this.reports.add(key);
    return true;
  }

  async reported(limit: number) {
    const counts = new Map<string, number>();
    for (const key of this.reports) {
      const id = key.split('|')[0];
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return this.messages
      .filter((message) => message.deletedAt === null && counts.has(message.id))
      .map((message) => ({ message: { ...message }, reports: counts.get(message.id)! }))
      .sort((a, b) => b.reports - a.reports || b.message.createdAt - a.message.createdAt)
      .slice(0, limit);
  }

  async removeByAuthor(userId: string, _by: string, at: number) {
    const removed: string[] = [];
    for (const message of this.messages)
      if (message.userId === userId && message.deletedAt === null) {
        message.deletedAt = at;
        removed.push(message.id);
      }
    return removed;
  }
}

type MessageRow = {
  id: string;
  user_id: string;
  username: string;
  party: string | null;
  text: string;
  created_at: Date;
  deleted_at: Date | null;
};

const toMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  userId: row.user_id,
  username: row.username,
  party: row.party,
  text: row.text,
  createdAt: row.created_at.getTime(),
  deletedAt: row.deleted_at?.getTime() ?? null,
});

/** Postgres store (Supabase). Creates its tables on first use. */
export class PostgresChatStore implements ChatStore {
  private sql;
  private ready: Promise<unknown> | null = null;
  constructor(url: string) {
    this.sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
  }

  private schema() {
    this.ready ??= this.sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        username text NOT NULL,
        party text,
        text text NOT NULL,
        created_at timestamptz NOT NULL,
        deleted_at timestamptz,
        deleted_by text
      );
      CREATE INDEX IF NOT EXISTS chat_messages_recent ON chat_messages (created_at DESC);
      CREATE INDEX IF NOT EXISTS chat_messages_user ON chat_messages (user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS chat_reports (
        message_id text NOT NULL REFERENCES chat_messages(id),
        user_id text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (message_id, user_id)
      );
    `
      .simple()
      .catch((error) => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }

  async add(m: ChatMessage) {
    await this.schema();
    await this.sql`
      INSERT INTO chat_messages (id, user_id, username, party, text, created_at)
      VALUES (${m.id}, ${m.userId}, ${m.username}, ${m.party}, ${m.text}, ${new Date(m.createdAt)})`;
  }

  async recent(limit: number) {
    await this.schema();
    const rows = await this.sql<MessageRow[]>`
      SELECT * FROM chat_messages WHERE deleted_at IS NULL
      ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map(toMessage).reverse();
  }

  async get(id: string) {
    await this.schema();
    const [row] = await this.sql<MessageRow[]>`SELECT * FROM chat_messages WHERE id = ${id}`;
    return row ? toMessage(row) : null;
  }

  async remove(id: string, by: string, at: number) {
    await this.schema();
    const rows = await this.sql`
      UPDATE chat_messages SET deleted_at = ${new Date(at)}, deleted_by = ${by}
      WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
    return rows.length > 0;
  }

  async report(messageId: string, userId: string, at: number) {
    await this.schema();
    const rows = await this.sql`
      INSERT INTO chat_reports (message_id, user_id, created_at)
      VALUES (${messageId}, ${userId}, ${new Date(at)})
      ON CONFLICT DO NOTHING RETURNING message_id`;
    return rows.length > 0;
  }

  async reported(limit: number) {
    await this.schema();
    const rows = await this.sql<(MessageRow & { reports: string })[]>`
      SELECT m.*, r.reports FROM chat_messages m
      JOIN (SELECT message_id, count(*) AS reports FROM chat_reports GROUP BY message_id) r
        ON r.message_id = m.id
      WHERE m.deleted_at IS NULL
      ORDER BY r.reports DESC, m.created_at DESC LIMIT ${limit}`;
    return rows.map((row) => ({ message: toMessage(row), reports: Number(row.reports) }));
  }

  async removeByAuthor(userId: string, by: string, at: number) {
    await this.schema();
    const rows = await this.sql<{ id: string }[]>`
      UPDATE chat_messages SET deleted_at = ${new Date(at)}, deleted_by = ${by}
      WHERE user_id = ${userId} AND deleted_at IS NULL RETURNING id`;
    return rows.map((row) => row.id);
  }
}
