export type ChatMessage = {
  id: string;
  userId: string;
  /** Snapshot of the author's public name and side when the message was sent. */
  username: string;
  party: string | null;
  /** The author's photo ("key.version") when the message was sent; null without one. */
  photo: string | null;
  text: string;
  /** Sticker id when the message is a sticker; `text` then holds its caption. */
  sticker: string | null;
  createdAt: number;
  deletedAt: number | null;
};

/** What other people see: never the account id or e-mail. */
export type PublicMessage = Pick<
  ChatMessage,
  'id' | 'username' | 'party' | 'photo' | 'text' | 'sticker' | 'createdAt'
>;

export type ChatEvent =
  | { type: 'message'; message: PublicMessage }
  | { type: 'delete'; id: string };

export const toPublic = ({
  id,
  username,
  party,
  photo,
  text,
  sticker,
  createdAt,
}: ChatMessage): PublicMessage => ({ id, username, party, photo, text, sticker, createdAt });

export interface ChatStore {
  add(message: ChatMessage): Promise<void>;
  /** Latest visible messages, oldest first. */
  recent(limit: number): Promise<ChatMessage[]>;
  get(id: string): Promise<ChatMessage | null>;
  remove(id: string, by: string, at: number): Promise<boolean>;
  /** One report per person per message; returns false when already reported. */
  report(messageId: string, userId: string, at: number): Promise<boolean>;
  /** Visible messages with at least one report, most reported first. */
  reported(limit: number): Promise<{ message: ChatMessage; reports: number }[]>;
  /** Removes every visible message of an author; returns their ids. */
  removeByAuthor(userId: string, by: string, at: number): Promise<string[]>;
}

/** Fan-out of chat events to every server, plus cross-server counters. */
export interface ChatBus {
  publish(event: ChatEvent): Promise<void>;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  /** Takes a slot for `key` for `ms`; false when it is still taken (slow mode). */
  claim(key: string, ms: number): Promise<boolean>;
  /** Reports how many chat connections this server holds; returns the total across servers. */
  online(local: number): Promise<number>;
}
