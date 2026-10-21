import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { watchedSeconds } from './access';
import type {
  AccessStats,
  AccessStore,
  AccessUser,
  PaymentStatus,
  PixPayment,
  ProfileInput,
  UserQuery,
} from './types';

const usernameKey = (username: string) => username.toLowerCase();

type Data = { users: Record<string, AccessUser>; payments: Record<string, PixPayment> };

/** Defaults for a new account (and for records saved before these fields existed). */
const newUser = (id: string): AccessUser => ({
  id,
  email: '',
  name: '',
  freeSecondsUsed: 0,
  lastSeenAt: null,
  paidAt: null,
  paymentId: null,
  sessionId: null,
  sessionChanges: 0,
  username: null,
  party: null,
  partyConsentAt: null,
  onboardedAt: null,
  createdAt: null,
  pausedAt: null,
  pausedReason: null,
  deletedAt: null,
  photoVersion: null,
});

/** What an anonymized account keeps: its id, payments and counters, never personal data. */
const ANONYMOUS = {
  email: '',
  name: 'Conta excluída',
  username: null,
  party: null,
  photoVersion: null,
};

const matches = (user: AccessUser, query?: string) => {
  const q = query?.trim().toLowerCase().replace(/^@/, '');
  return (
    !q ||
    [user.id, user.email, user.username ?? '', user.name].some((field) =>
      field.toLowerCase().includes(q),
    )
  );
};

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
      const existing = data.users[id];
      // An anonymized account stays anonymous even if the same person signs in again.
      const user = (data.users[id] = {
        ...newUser(id),
        ...existing,
        createdAt: existing?.createdAt ?? Date.now(),
        ...(existing?.deletedAt ? {} : { email, name }),
      });
      return { ...user };
    });
  }

  async getUser(id: string) {
    await this.load();
    const user = this.data.users[id];
    return user ? { ...newUser(id), ...user } : null;
  }

  async startSession(id: string, sessionId: string) {
    await this.change((data) => {
      const user = data.users[id];
      if (!user) return;
      if (user.sessionId && user.sessionId !== sessionId)
        user.sessionChanges = (user.sessionChanges ?? 0) + 1;
      user.sessionId = sessionId;
    });
  }

  async saveProfile(id: string, profile: ProfileInput, now: number) {
    return this.change((data) => {
      const user = data.users[id];
      if (!user) return 'missing' as const;
      const key = usernameKey(profile.username);
      if (
        Object.values(data.users).some(
          (other) => other.id !== id && other.username && usernameKey(other.username) === key,
        )
      )
        return 'taken' as const;
      Object.assign(user, {
        ...profile,
        onboardedAt: user.onboardedAt ?? now,
        // Time spent filling the form is not free time: the next request starts counting fresh.
        lastSeenAt: null,
      });
      return 'ok' as const;
    });
  }

  async usernameTaken(username: string, exceptId?: string) {
    await this.load();
    const key = usernameKey(username);
    return Object.values(this.data.users).some(
      (user) => user.id !== exceptId && !!user.username && usernameKey(user.username) === key,
    );
  }

  async userIdByUsername(username: string) {
    await this.load();
    const key = usernameKey(username);
    return (
      Object.values(this.data.users).find(
        (user) => !user.deletedAt && !!user.username && usernameKey(user.username) === key,
      )?.id ?? null
    );
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

  async setPaused(id: string, pause: { at: number; reason: string } | null) {
    return this.change((data) => {
      const user = data.users[id];
      if (!user) return false;
      Object.assign(user, { pausedAt: pause?.at ?? null, pausedReason: pause?.reason ?? null });
      return true;
    });
  }

  async anonymize(id: string, at: number) {
    return this.change((data) => {
      const user = data.users[id];
      if (!user) return false;
      Object.assign(user, ANONYMOUS, { partyConsentAt: null, sessionId: null, deletedAt: at });
      return true;
    });
  }

  async setPhoto(id: string, version: number | null) {
    return this.change((data) => {
      const user = data.users[id];
      if (!user) return false;
      user.photoVersion = version;
      return true;
    });
  }

  async listUsers({ query, limit, offset }: UserQuery) {
    await this.load();
    const found = Object.values(this.data.users)
      .map((user) => ({ ...newUser(user.id), ...user }))
      .filter((user) => matches(user, query))
      .sort((a, b) => (b.lastSeenAt ?? b.createdAt ?? 0) - (a.lastSeenAt ?? a.createdAt ?? 0));
    return { users: found.slice(offset, offset + limit), total: found.length };
  }

  async stats(): Promise<AccessStats> {
    await this.load();
    const users = Object.values(this.data.users);
    const approved = Object.values(this.data.payments).filter((p) => p.status === 'approved');
    return {
      users: users.length,
      onboarded: users.filter((u) => u.onboardedAt).length,
      paid: users.filter((u) => u.paidAt).length,
      paused: users.filter((u) => u.pausedAt).length,
      deleted: users.filter((u) => u.deletedAt).length,
      switchedDevices: users.filter((u) => (u.sessionChanges ?? 0) > 0).length,
      revenue: Math.round(approved.reduce((sum, p) => sum + p.amount, 0) * 100) / 100,
      approvedPayments: approved.length,
    };
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
  session_id: string | null;
  session_changes: number;
  username: string | null;
  party: string | null;
  party_consent_at: Date | null;
  onboarded_at: Date | null;
  created_at: Date | null;
  paused_at: Date | null;
  paused_reason: string | null;
  deleted_at: Date | null;
  photo_version: string | null;
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
  sessionId: row.session_id,
  sessionChanges: Number(row.session_changes),
  username: row.username,
  party: row.party,
  partyConsentAt: row.party_consent_at?.getTime() ?? null,
  onboardedAt: row.onboarded_at?.getTime() ?? null,
  createdAt: row.created_at?.getTime() ?? null,
  pausedAt: row.paused_at?.getTime() ?? null,
  pausedReason: row.paused_reason,
  deletedAt: row.deleted_at?.getTime() ?? null,
  photoVersion: row.photo_version === null ? null : Number(row.photo_version),
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
    this.sql = postgres(url, { prepare: false, max: 10, idle_timeout: 20 });
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
        ADD COLUMN IF NOT EXISTS photo_version bigint;
      CREATE UNIQUE INDEX IF NOT EXISTS access_users_username ON access_users (lower(username));
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
      ON CONFLICT (id) DO UPDATE SET
        email = CASE WHEN access_users.deleted_at IS NULL THEN EXCLUDED.email ELSE access_users.email END,
        name = CASE WHEN access_users.deleted_at IS NULL THEN EXCLUDED.name ELSE access_users.name END
      RETURNING *`;
    return toUser(row);
  }

  async getUser(id: string) {
    await this.schema();
    const [row] = await this.sql<UserRow[]>`SELECT * FROM access_users WHERE id = ${id}`;
    return row ? toUser(row) : null;
  }

  async startSession(id: string, sessionId: string) {
    await this.schema();
    await this.sql`
      UPDATE access_users SET
        session_changes = session_changes + CASE
          WHEN session_id IS NOT NULL AND session_id <> ${sessionId} THEN 1 ELSE 0 END,
        session_id = ${sessionId}
      WHERE id = ${id}`;
  }

  async saveProfile(id: string, profile: ProfileInput, now: number) {
    await this.schema();
    try {
      const rows = await this.sql`
        UPDATE access_users SET
          username = ${profile.username},
          party = ${profile.party},
          party_consent_at = ${profile.partyConsentAt === null ? null : new Date(profile.partyConsentAt)},
          onboarded_at = COALESCE(onboarded_at, ${new Date(now)}),
          last_seen_at = NULL
        WHERE id = ${id}
        RETURNING id`;
      return rows.length ? ('ok' as const) : ('missing' as const);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return 'taken' as const;
      throw error;
    }
  }

  async usernameTaken(username: string, exceptId?: string) {
    await this.schema();
    const rows = await this.sql`
      SELECT 1 FROM access_users
      WHERE lower(username) = ${usernameKey(username)} AND id <> ${exceptId ?? ''}
      LIMIT 1`;
    return rows.length > 0;
  }

  async userIdByUsername(username: string) {
    await this.schema();
    const [row] = await this.sql<{ id: string }[]>`
      SELECT id FROM access_users
      WHERE lower(username) = ${usernameKey(username)} AND deleted_at IS NULL
      LIMIT 1`;
    return row?.id ?? null;
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

  async setPaused(id: string, pause: { at: number; reason: string } | null) {
    await this.schema();
    const rows = await this.sql`
      UPDATE access_users SET
        paused_at = ${pause ? new Date(pause.at) : null},
        paused_reason = ${pause?.reason ?? null}
      WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }

  async anonymize(id: string, at: number) {
    await this.schema();
    const rows = await this.sql`
      UPDATE access_users SET
        email = ${ANONYMOUS.email}, name = ${ANONYMOUS.name}, username = NULL, party = NULL,
        party_consent_at = NULL, session_id = NULL, photo_version = NULL,
        deleted_at = ${new Date(at)}
      WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }

  async setPhoto(id: string, version: number | null) {
    await this.schema();
    const rows = await this.sql`
      UPDATE access_users SET photo_version = ${version} WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }

  async listUsers({ query, limit, offset }: UserQuery) {
    await this.schema();
    const q = query?.trim().toLowerCase().replace(/^@/, '') ?? '';
    const pattern = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const where = q
      ? this.sql`WHERE lower(id) LIKE ${pattern} OR lower(email) LIKE ${pattern}
          OR lower(coalesce(username, '')) LIKE ${pattern} OR lower(name) LIKE ${pattern}`
      : this.sql``;
    const [rows, [{ count }]] = await Promise.all([
      this.sql<UserRow[]>`
        SELECT * FROM access_users ${where}
        ORDER BY coalesce(last_seen_at, created_at) DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}`,
      this.sql<{ count: string }[]>`SELECT count(*) FROM access_users ${where}`,
    ]);
    return { users: rows.map(toUser), total: Number(count) };
  }

  async stats(): Promise<AccessStats> {
    await this.schema();
    const [users] = await this.sql<Record<string, string>[]>`
      SELECT count(*) AS users, count(onboarded_at) AS onboarded, count(paid_at) AS paid,
        count(paused_at) AS paused, count(deleted_at) AS deleted,
        count(*) FILTER (WHERE session_changes > 0) AS switched
      FROM access_users`;
    const [payments] = await this.sql<Record<string, string | null>[]>`
      SELECT count(*) AS approved, coalesce(sum(amount), 0) AS revenue
      FROM access_payments WHERE status = 'approved'`;
    return {
      users: Number(users.users),
      onboarded: Number(users.onboarded),
      paid: Number(users.paid),
      paused: Number(users.paused),
      deleted: Number(users.deleted),
      switchedDevices: Number(users.switched),
      revenue: Number(payments.revenue),
      approvedPayments: Number(payments.approved),
    };
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
