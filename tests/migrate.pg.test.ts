import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { ensureSchema } from '../src/lib/db/migrate';

/** Needs a real Postgres: `TEST_DATABASE_URL=postgres://… npx vitest run tests/migrate.pg.test.ts`. */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('ensureSchema against Postgres', () => {
  it('migrates once under concurrent starts, never deadlocks, and skips DDL afterwards', async () => {
    // Own database: other test files share TEST_DATABASE_URL and run in parallel.
    const root = postgres(url!, { prepare: false, onnotice: () => {}, max: 1 });
    const name = 'mig_test_' + Math.random().toString(36).slice(2, 10);
    await root.unsafe('CREATE DATABASE ' + name);
    const dbUrl = new URL(url!);
    dbUrl.pathname = '/' + name;
    const target = dbUrl.toString();
    const admin = postgres(target, { prepare: false, onnotice: () => {}, max: 2 });
    const ddl = `
      CREATE TABLE IF NOT EXISTS mig_a (id text PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS mig_b (id text PRIMARY KEY, a text REFERENCES mig_a(id));
      ALTER TABLE mig_a ADD COLUMN IF NOT EXISTS extra text;
      ALTER TABLE mig_b ADD COLUMN IF NOT EXISTS extra text;`;
    // Eight "processes" boot together while traffic keeps writing to both tables.
    const apps = Array.from({ length: 8 }, () =>
      postgres(target, { prepare: false, onnotice: () => {}, max: 4 }),
    );
    try {
      await Promise.all(apps.map((sql) => ensureSchema(sql, 'mig', 1, ddl)));
      await Promise.all(
        apps.map(async (sql, i) => {
          await sql`INSERT INTO mig_a (id) VALUES (${'a' + i})`;
          await sql`INSERT INTO mig_b (id, a) VALUES (${'b' + i}, ${'a' + i})`;
        }),
      );
      const [{ version }] = await admin<{ version: number }[]>`
        SELECT version FROM app_schema WHERE name = 'mig'`;
      expect(version).toBe(1);

      // Already recorded: no DDL runs, so no ACCESS EXCLUSIVE lock is ever requested. Prove it by
      // holding a row lock on mig_a in another transaction: a real ALTER TABLE would block.
      await admin.begin(async (tx) => {
        await tx`SELECT * FROM mig_a WHERE id = 'a0' FOR UPDATE`;
        const started = Date.now();
        await ensureSchema(apps[0], 'mig', 1, ddl);
        expect(Date.now() - started).toBeLessThan(1_000);
      });

      // A new version applies exactly once even when everyone asks at the same time.
      await Promise.all(
        apps.map((sql) =>
          ensureSchema(sql, 'mig', 2, `${ddl} ALTER TABLE mig_a ADD COLUMN IF NOT EXISTS v2 text;`),
        ),
      );
      const [{ v2 }] = await admin<{ v2: number }[]>`
        SELECT count(*)::int AS v2 FROM information_schema.columns
        WHERE table_name = 'mig_a' AND column_name = 'v2'`;
      expect(v2).toBe(1);
    } finally {
      await Promise.all([admin, ...apps].map((sql) => sql.end()));
      await root.unsafe('DROP DATABASE IF EXISTS ' + name);
      await root.end();
    }
  }, 60_000);
});
