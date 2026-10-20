import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { watchedSeconds } from './access';
import type { AccessStore, AccessUser, PaymentStatus, PixPayment } from './types';

type Data = { users: Record<string, AccessUser>; payments: Record<string, PixPayment> };

/** In-process store, optionally mirrored to a JSON file. For local development and tests only. */
export class FileAccessStore implements AccessStore {
  private data: Data = { users: {}, payments: {} };
  private loaded: Promise<void> | null = null;
  private queue = Promise.resolve();
  constructor(private file: string | null = null) {}

  private load() {
    this.loaded ??= (async () => {
      if (!this.file) return;
      try {
        this.data = JSON.parse(await readFile(this.file, 'utf8'));
      } catch {
        // First run: no file yet.
      }
    })();
    return this.loaded;
  }

  /** Serializes read-modify-write so concurrent requests cannot lose updates. */
  private async change<T>(apply: (data: Data) => T): Promise<T> {
    const run = this.queue.then(async () => {
      await this.load();
      const result = apply(this.data);
      if (this.file) {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(this.data, null, 2));
        await rename(`${this.file}.tmp`, this.file);
      }
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async upsertUser({ id, email, name }: Pick<AccessUser, 'id' | 'email' | 'name'>) {
    return this.change((data) => {
      const user = (data.users[id] = {
        ...(data.users[id] ?? {
          id,
          freeSecondsUsed: 0,
          lastSeenAt: null,
          paidAt: null,
          paymentId: null,
        }),
        email,
        name,
      });
      return { ...user };
    });
  }

  async getUser(id: string) {
    await this.load();
    const user = this.data.users[id];
    return user ? { ...user } : null;
  }

  async touch(id: string, now: number, maxGapSeconds: number, count = true) {
    return this.change((data) => {
      const user = data.users[id];
      if (!user) return null;
      if (user.paidAt === null && count)
        user.freeSecondsUsed += watchedSeconds(user.lastSeenAt, now, maxGapSeconds);
      user.lastSeenAt = now;
      return { ...user };
    });
  }

  async markPaid(id: string, paymentId: string, paidAt: number) {
    await this.change((data) => {
      const user = data.users[id];
      if (user && user.paidAt === null) Object.assign(user, { paidAt, paymentId });
    });
  }

  async savePayment(payment: PixPayment) {
    await this.change((data) => {
      data.payments[payment.id] = { ...payment };
    });
  }

  async setPaymentStatus(id: string, status: PaymentStatus) {
    await this.change((data) => {
      if (data.payments[id]) data.payments[id].status = status;
    });
  }

  async latestPayment(userId: string) {
    await this.load();
    const latest = Object.values(this.data.payments)
      .filter((payment) => payment.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return latest ? { ...latest } : null;
  }

  async getPayment(id: string) {
    await this.load();
    const payment = this.data.payments[id];
    return payment ? { ...payment } : null;
  }
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  free_seconds_used: number;
  last_seen_at: Date | null;
  paid_at: Date | null;
  payment_id: string | null;
};
type PaymentRow = {
  id: string;
  user_id: string;
  status: PaymentStatus;
  amount: string;
  qr_code: string;
  qr_code_base64: string | null;
  expires_at: Date;
  created_at: Date;
};

const toUser = (row: UserRow): AccessUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  freeSecondsUsed: Number(row.free_seconds_used),
  lastSeenAt: row.last_seen_at?.getTime() ?? null,
  paidAt: row.paid_at?.getTime() ?? null,
  paymentId: row.payment_id,
});
const toPayment = (row: PaymentRow): PixPayment => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  amount: Number(row.amount),
  qrCode: row.qr_code,
  qrCodeBase64: row.qr_code_base64,
  expiresAt: row.expires_at.getTime(),
  createdAt: row.created_at.getTime(),
});

/** Postgres store. Creates its tables on first use; each change is a single atomic statement. */
export class PostgresAccessStore implements AccessStore {
  private sql;
  private ready: Promise<unknown> | null = null;
  constructor(url: string) {
    // `prepare: false` keeps it compatible with transaction poolers such as Neon and Supabase.
    this.sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
  }

  private schema() {
    this.ready ??= this.sql`
      CREATE TABLE IF NOT EXISTS access_users (
        id text PRIMARY KEY,
        email text NOT NULL,
        name text NOT NULL,
        free_seconds_used double precision NOT NULL DEFAULT 0,
        last_seen_at timestamptz,
        paid_at timestamptz,
        payment_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS access_payments (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES access_users(id),
        status text NOT NULL,
        amount numeric(10, 2) NOT NULL,
        qr_code text NOT NULL,
        qr_code_base64 text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS access_payments_user ON access_payments (user_id, created_at DESC);
    `
      .simple()
      .catch((error) => {
        // Let the next request retry instead of caching the failure.
        this.ready = null;
        throw error;
      });
    return this.ready;
  }

  async upsertUser({ id, email, name }: Pick<AccessUser, 'id' | 'email' | 'name'>) {
    await this.schema();
    const [row] = await this.sql<UserRow[]>`
      INSERT INTO access_users (id, email, name) VALUES (${id}, ${email}, ${name})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
      RETURNING *`;
    return toUser(row);
  }

  async getUser(id: string) {
    await this.schema();
    const [row] = await this.sql<UserRow[]>`SELECT * FROM access_users WHERE id = ${id}`;
    return row ? toUser(row) : null;
  }

  async touch(id: string, now: number, maxGapSeconds: number, count = true) {
    await this.schema();
    const at = new Date(now);
    const [row] = await this.sql<UserRow[]>`
      UPDATE access_users SET
        free_seconds_used = free_seconds_used + CASE
          WHEN paid_at IS NOT NULL OR last_seen_at IS NULL OR NOT ${count} THEN 0
          ELSE LEAST(GREATEST(EXTRACT(EPOCH FROM (${at}::timestamptz - last_seen_at)), 0), ${maxGapSeconds})
        END,
        last_seen_at = ${at}
      WHERE id = ${id}
      RETURNING *`;
    return row ? toUser(row) : null;
  }

  async markPaid(id: string, paymentId: string, paidAt: number) {
    await this.schema();
    await this.sql`
      UPDATE access_users SET paid_at = ${new Date(paidAt)}, payment_id = ${paymentId}
      WHERE id = ${id} AND paid_at IS NULL`;
  }

  async savePayment(p: PixPayment) {
    await this.schema();
    await this.sql`
      INSERT INTO access_payments
        (id, user_id, status, amount, qr_code, qr_code_base64, expires_at, created_at)
      VALUES (${p.id}, ${p.userId}, ${p.status}, ${p.amount}, ${p.qrCode}, ${p.qrCodeBase64},
        ${new Date(p.expiresAt)}, ${new Date(p.createdAt)})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`;
  }

  async setPaymentStatus(id: string, status: PaymentStatus) {
    await this.schema();
    await this.sql`UPDATE access_payments SET status = ${status} WHERE id = ${id}`;
  }

  async latestPayment(userId: string) {
    await this.schema();
    const [row] = await this.sql<PaymentRow[]>`
      SELECT * FROM access_payments WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 1`;
    return row ? toPayment(row) : null;
  }

  async getPayment(id: string) {
    await this.schema();
    const [row] = await this.sql<PaymentRow[]>`SELECT * FROM access_payments WHERE id = ${id}`;
    return row ? toPayment(row) : null;
  }
}

const globalStore = globalThis as { __accessStore?: AccessStore };

/** Postgres when DATABASE_URL is set; otherwise a local JSON file (refused on Vercel). */
export function accessStore(): AccessStore {
  if (globalStore.__accessStore) return globalStore.__accessStore;
  const url = process.env.DATABASE_URL;
  if (!url && process.env.VERCEL)
    throw new Error('DATABASE_URL is required on Vercel: the filesystem does not persist.');
  globalStore.__accessStore = url
    ? new PostgresAccessStore(url)
    : new FileAccessStore(path.join(process.cwd(), '.data', 'access.json'));
  return globalStore.__accessStore;
}
