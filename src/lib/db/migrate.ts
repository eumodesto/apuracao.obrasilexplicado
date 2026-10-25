import type postgres from 'postgres';

type Sql = postgres.Sql;

/**
 * Versioned, race-free schema setup shared by every Postgres store.
 *
 * Running `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS` on every boot
 * is NOT harmless: ALTER TABLE takes an ACCESS EXCLUSIVE lock even when it changes nothing, so
 * three app processes starting together (a deploy) while visitors write to the same tables
 * deadlocked each other and answered 503/504 until they all retried. Here:
 *  - nothing is executed when `app_schema` already records `version` (the steady state);
 *  - otherwise one process at a time migrates (global advisory lock), with a bounded lock wait;
 *  - lock conflicts back off and retry instead of failing the visitor's request.
 *
 * To change a store's tables, edit its DDL (keep it idempotent) and bump its version.
 */
const LOCK = `SELECT pg_advisory_xact_lock(hashtext('apuracao:schema'))`;
const RETRYABLE = new Set(['40P01', '55P03', '40001']);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function recorded(sql: Sql, name: string) {
  const [exists] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.app_schema') IS NOT NULL AS ok`;
  if (!exists?.ok) return 0;
  const [row] = await sql<{ version: number }[]>`
    SELECT version FROM app_schema WHERE name = ${name}`;
  return row?.version ?? 0;
}

export async function ensureSchema(sql: Sql, name: string, version: number, ddl: string) {
  if ((await recorded(sql, name)) >= version) return;
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL lock_timeout = '5s'`);
        await tx.unsafe(LOCK);
        await tx.unsafe(
          `CREATE TABLE IF NOT EXISTS app_schema (name text PRIMARY KEY, version integer NOT NULL)`,
        );
        const [row] = await tx<{ version: number }[]>`
          SELECT version FROM app_schema WHERE name = ${name}`;
        if ((row?.version ?? 0) >= version) return;
        await tx.unsafe(ddl).simple();
        await tx`
          INSERT INTO app_schema (name, version) VALUES (${name}, ${version})
          ON CONFLICT (name) DO UPDATE SET version = GREATEST(app_schema.version, EXCLUDED.version)`;
      });
      return;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      if (!code || !RETRYABLE.has(code)) throw error;
      await wait(200 * 2 ** attempt + Math.random() * 200);
    }
  }
  throw lastError;
}
