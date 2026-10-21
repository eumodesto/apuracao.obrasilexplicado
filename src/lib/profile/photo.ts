import { createHmac } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import sharp from 'sharp';
import { sessionSecret } from '@/lib/access/config';
import type { AccessUser } from '@/lib/access/types';

/** Side of the stored square photo, in pixels. */
export const PHOTO_SIZE = 256;
/** Largest upload accepted; the page already shrinks photos before sending. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Public address of an account's photo. Derived from the account id with the server secret, so
 * it never reveals the id and nobody can guess another account's address.
 */
export const photoKey = (userId: string) =>
  createHmac('sha256', sessionSecret()).update(`photo:${userId}`).digest('hex').slice(0, 24);

/** "key.version": what chat messages carry; the version changes the address on every new photo. */
export const photoRef = (user: Pick<AccessUser, 'id' | 'photoVersion'>) =>
  user.photoVersion == null ? null : `${photoKey(user.id)}.${user.photoVersion.toString(36)}`;

export const photoUrl = (ref: string | null) => (ref ? `/api/chat/photo/${ref}` : null);

export const validPhotoKey = (key: string) => /^[0-9a-f]{24}$/.test(key);

/**
 * Decodes any common image, turns it upright, crops the center square and re-encodes it as JPEG.
 * Whatever was uploaded (metadata, location, hidden content) never reaches other people.
 */
export async function processPhoto(input: Uint8Array) {
  try {
    return await sharp(input, { limitInputPixels: 50_000_000, failOn: 'error' })
      .rotate()
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: 'attention' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

export interface PhotoStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

/** Files under `.data/photos` for local development; memory only when no directory is given. */
export class FilePhotoStore implements PhotoStore {
  private memory = new Map<string, Buffer>();
  constructor(private dir: string | null = null) {}

  private file = (key: string) => path.join(this.dir!, `${key}.jpg`);

  async put(key: string, data: Buffer) {
    if (!this.dir) return void this.memory.set(key, data);
    await mkdir(this.dir, { recursive: true });
    await writeFile(`${this.file(key)}.tmp`, data);
    await rename(`${this.file(key)}.tmp`, this.file(key));
  }

  async get(key: string) {
    if (!this.dir) return this.memory.get(key) ?? null;
    return readFile(this.file(key)).catch(() => null);
  }

  async remove(key: string) {
    if (!this.dir) return void this.memory.delete(key);
    await rm(this.file(key), { force: true });
  }
}

/** Postgres (Supabase): ~15 KB per photo. Creates its table on first use. */
export class PostgresPhotoStore implements PhotoStore {
  private sql;
  private ready: Promise<unknown> | null = null;
  constructor(url: string) {
    this.sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
  }

  private schema() {
    this.ready ??= this.sql`
      CREATE TABLE IF NOT EXISTS profile_photos (
        key text PRIMARY KEY,
        data bytea NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`.catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  async put(key: string, data: Buffer) {
    await this.schema();
    await this.sql`
      INSERT INTO profile_photos (key, data) VALUES (${key}, ${data})
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  }

  async get(key: string) {
    await this.schema();
    const [row] = await this.sql<{ data: Buffer }[]>`
      SELECT data FROM profile_photos WHERE key = ${key}`;
    return row?.data ?? null;
  }

  async remove(key: string) {
    await this.schema();
    await this.sql`DELETE FROM profile_photos WHERE key = ${key}`;
  }
}

const shared = globalThis as { __photoStore?: PhotoStore };

export function photoStore() {
  shared.__photoStore ??= process.env.DATABASE_URL
    ? new PostgresPhotoStore(process.env.DATABASE_URL)
    : new FilePhotoStore(path.join(process.cwd(), '.data', 'photos'));
  return shared.__photoStore;
}
