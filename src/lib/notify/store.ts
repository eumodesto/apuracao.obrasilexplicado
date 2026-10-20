import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

/** E-mails that asked to be told when the count starts. */
export interface NotifyStore {
  /** 'added' for a new address, 'exists' when it was already on the list. */
  add(email: string, at: number): Promise<'added' | 'exists'>;
  list(): Promise<{ email: string; createdAt: number }[]>;
}

/** Local development: a JSON file next to the access data. */
export class FileNotifyStore implements NotifyStore {
  private queue = Promise.resolve();
  constructor(private file: string | null = null) {}
  private memory: Record<string, number> = {};
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      this.memory = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      // First run.
    }
  }

  add(email: string, at: number) {
    const run = this.queue.then(async () => {
      await this.load();
      if (this.memory[email]) return 'exists' as const;
      this.memory[email] = at;
      if (this.file) {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(this.memory, null, 2));
        await rename(`${this.file}.tmp`, this.file);
      }
      return 'added' as const;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async list() {
    await this.load();
    return Object.entries(this.memory).map(([email, createdAt]) => ({ email, createdAt }));
  }
}

export class PostgresNotifyStore implements NotifyStore {
  private sql;
  private ready: Promise<unknown> | null = null;
  constructor(url: string) {
    this.sql = postgres(url, { prepare: false, max: 2, idle_timeout: 20 });
  }

  private schema() {
    this.ready ??= this.sql`
      CREATE TABLE IF NOT EXISTS notify_signups (
        email text PRIMARY KEY,
        created_at timestamptz NOT NULL,
        notified_at timestamptz
      );
    `
      .simple()
      .catch((error) => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }

  async add(email: string, at: number) {
    await this.schema();
    const rows = await this.sql`
      INSERT INTO notify_signups (email, created_at) VALUES (${email}, ${new Date(at)})
      ON CONFLICT (email) DO NOTHING RETURNING email`;
    return rows.length ? ('added' as const) : ('exists' as const);
  }

  async list() {
    await this.schema();
    const rows = await this.sql<{ email: string; created_at: Date }[]>`
      SELECT email, created_at FROM notify_signups ORDER BY created_at`;
    return rows.map((row) => ({ email: row.email, createdAt: row.created_at.getTime() }));
  }
}

const runtime = globalThis as { __notifyStore?: NotifyStore };

export function notifyStore(): NotifyStore {
  runtime.__notifyStore ??= process.env.DATABASE_URL
    ? new PostgresNotifyStore(process.env.DATABASE_URL)
    : new FileNotifyStore(path.join(process.cwd(), '.data', 'notify.json'));
  return runtime.__notifyStore;
}

/** Normalized address, or null when it does not look like an e-mail. */
export function cleanEmail(input: unknown) {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(email) ? email : null;
}
