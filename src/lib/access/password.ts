import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { ensureSchema } from '@/lib/db/migrate';

/**
 * Passwords are stored only as scrypt hashes, in their own table, so they never travel with the
 * account record (admin listings, access status). Format: scrypt$N$r$p$salt$hash (base64url).
 * scripts/set-password.mjs writes the same format.
 */
const N = 16384,
  R = 8,
  P = 1,
  KEY_LENGTH = 64;
/** Any non-empty password is accepted — ease of signup over strength. */
export const MIN_PASSWORD = 1;
export const MAX_PASSWORD = 200;

const scrypt = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null) {
  const [kind, n, r, p, salt, hash] = (stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) {
    // Same work when there is no account, so timing does not reveal which e-mails exist.
    await scrypt(password, Buffer.alloc(16), KEY_LENGTH, { N, r: R, p: P });
    return false;
  }
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Checks a new password; returns the problem in Portuguese, or null. */
export function passwordProblem(password: string) {
  if (password.length < MIN_PASSWORD)
    return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (password.length > MAX_PASSWORD) return 'A senha é longa demais.';
  return null;
}

export const cleanEmail = (value: unknown) => {
  const email = String(value ?? '')
    .trim()
    .toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};

/** Domains people mistype, with the one they meant. Mercado Pago's risk check sees the e-mail. */
const DOMAIN_TYPOS: Record<string, string> = {
  'gmai.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmeil.com': 'gmail.com',
  'gemail.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.com.br': 'gmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmil.com': 'hotmail.com',
  'homail.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloook.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yaoo.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'icloud.con': 'icloud.com',
  'iclod.com': 'icloud.com',
};

/** Addresses we invent for accounts without one: never valid for a real payer. */
const SYNTHETIC_DOMAIN = '@pagadores.portaleleicao.com.br';

export type EmailCheck = { ok: true; email: string } | { ok: false; error: string };

/**
 * A real, deliverable-looking e-mail: the payer e-mail Mercado Pago uses to approve and notify
 * the payment. Rejects bad formats, our own placeholder domain and common domain typos.
 */
export function checkEmail(value: unknown): EmailCheck {
  const email = cleanEmail(value);
  if (!email) return { ok: false, error: 'Digite um e-mail válido.' };
  const [local, domain] = email.split('@');
  if (
    email.endsWith(SYNTHETIC_DOMAIN) ||
    !local ||
    local.length > 64 ||
    !/^[a-z0-9._%+'-]+$/.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ||
    domain.split('.').some((part) => !part || part.startsWith('-') || part.endsWith('-')) ||
    domain.split('.').pop()!.length < 2
  )
    return { ok: false, error: 'Digite um e-mail válido.' };
  const meant = DOMAIN_TYPOS[domain];
  if (meant) return { ok: false, error: `Confira o e-mail: você quis dizer ${local}@${meant}?` };
  return { ok: true, email };
}

/** Accounts created with e-mail and password: one id per e-mail (staff / admin / legacy). */
export const emailAccountId = (email: string) => `email:${email}`;

/** Public sign-up accounts: one id per username (case-insensitive). */
export const usernameAccountId = (username: string) => `user:${username.toLowerCase()}`;

export interface PasswordStore {
  get(userId: string): Promise<string | null>;
  /** Saves the hash only for an account without a password; false when one already exists. */
  create(userId: string, hash: string): Promise<boolean>;
  set(userId: string, hash: string): Promise<void>;
}

/** In memory, optionally mirrored to a JSON file. For local development and tests only. */
export class FilePasswordStore implements PasswordStore {
  private data: Record<string, string> | null = null;
  constructor(private file: string | null = null) {}

  private async load() {
    if (this.data) return this.data;
    try {
      this.data = this.file ? JSON.parse(await readFile(this.file, 'utf8')) : {};
    } catch {
      this.data = {};
    }
    return this.data!;
  }

  private async save() {
    if (!this.file) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.data));
    await rename(`${this.file}.tmp`, this.file);
  }

  async get(userId: string) {
    return (await this.load())[userId] ?? null;
  }

  async create(userId: string, hash: string) {
    const data = await this.load();
    if (data[userId]) return false;
    data[userId] = hash;
    await this.save();
    return true;
  }

  async set(userId: string, hash: string) {
    (await this.load())[userId] = hash;
    await this.save();
  }
}

export class PostgresPasswordStore implements PasswordStore {
  private sql;
  private ready: Promise<unknown> | null = null;
  constructor(url: string) {
    this.sql = postgres(url, { prepare: false, onnotice: () => {}, max: 3, idle_timeout: 20 });
  }

  private schema() {
    this.ready ??= ensureSchema(this.sql, 'access_passwords', 1, `
      CREATE TABLE IF NOT EXISTS access_passwords (
        user_id text PRIMARY KEY,
        hash text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`).catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  async get(userId: string) {
    await this.schema();
    const [row] = await this.sql<{ hash: string }[]>`
      SELECT hash FROM access_passwords WHERE user_id = ${userId}`;
    return row?.hash ?? null;
  }

  async create(userId: string, hash: string) {
    await this.schema();
    const rows = await this.sql`
      INSERT INTO access_passwords (user_id, hash) VALUES (${userId}, ${hash})
      ON CONFLICT (user_id) DO NOTHING RETURNING user_id`;
    return rows.length > 0;
  }

  async set(userId: string, hash: string) {
    await this.schema();
    await this.sql`
      INSERT INTO access_passwords (user_id, hash) VALUES (${userId}, ${hash})
      ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`;
  }
}

const shared = globalThis as { __passwordStore?: PasswordStore };

export function passwordStore() {
  shared.__passwordStore ??= process.env.DATABASE_URL
    ? new PostgresPasswordStore(process.env.DATABASE_URL)
    : new FilePasswordStore(path.join(process.cwd(), '.data', 'passwords.json'));
  return shared.__passwordStore;
}
