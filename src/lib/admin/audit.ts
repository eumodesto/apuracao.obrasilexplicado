import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

export type AuditEntry = {
  at: number;
  admin: string;
  action: 'pause' | 'unpause' | 'delete_user' | 'delete_message' | 'remove_photo';
  target: string;
  detail: string | null;
};

/** Record of every moderation action: who did what, to whom and when. */
export interface AuditStore {
  add(entry: AuditEntry): Promise<void>;
  list(limit: number): Promise<AuditEntry[]>;
}

export class FileAuditStore implements AuditStore {
  private entries: AuditEntry[] | null = null;
  private queue = Promise.resolve();
  constructor(private file: string | null = null) {}

  private async load() {
    if (this.entries) return this.entries;
    try {
      this.entries = this.file ? JSON.parse(await readFile(this.file, 'utf8')) : [];
    } catch {
      this.entries = [];
    }
    return this.entries!;
  }

  add(entry: AuditEntry) {
    const run = this.queue.then(async () => {
      const entries = await this.load();
      entries.push(entry);
      if (this.file) {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(entries, null, 2));
        await rename(`${this.file}.tmp`, this.file);
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list(limit: number) {
    return [...(await this.load())].sort((a, b) => b.at - a.at).slice(0, limit);
  }
}

export class PostgresAuditStore implements AuditStore {
  private sql;
  private ready: Promise<unknown> | null = null;
  constructor(url: string) {
    this.sql = postgres(url, { prepare: false, onnotice: () => {}, max: 2, idle_timeout: 20 });
  }

  private schema() {
    this.ready ??= this.sql`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id bigserial PRIMARY KEY,
        at timestamptz NOT NULL,
        admin text NOT NULL,
        action text NOT NULL,
        target text NOT NULL,
        detail text
      );
      CREATE INDEX IF NOT EXISTS admin_audit_at ON admin_audit (at DESC);
    `
      .simple()
      .catch((error) => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }

  async add(e: AuditEntry) {
    await this.schema();
    await this.sql`
      INSERT INTO admin_audit (at, admin, action, target, detail)
      VALUES (${new Date(e.at)}, ${e.admin}, ${e.action}, ${e.target}, ${e.detail})`;
  }

  async list(limit: number) {
    await this.schema();
    const rows = await this.sql<
      {
        at: Date;
        admin: string;
        action: AuditEntry['action'];
        target: string;
        detail: string | null;
      }[]
    >`SELECT at, admin, action, target, detail FROM admin_audit ORDER BY at DESC LIMIT ${limit}`;
    return rows.map((row) => ({ ...row, at: row.at.getTime() }));
  }
}

const runtime = globalThis as { __auditStore?: AuditStore };

export function auditStore(): AuditStore {
  runtime.__auditStore ??= process.env.DATABASE_URL
    ? new PostgresAuditStore(process.env.DATABASE_URL)
    : new FileAuditStore(path.join(process.cwd(), '.data', 'audit.json'));
  return runtime.__auditStore;
}
