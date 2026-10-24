import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdmin, isStaff } from '../src/lib/access/access';
import { currentAccess, sessionProblem } from '../src/lib/access/guard';
import { FileAccessStore, PostgresAccessStore } from '../src/lib/access/store';
import type { AccessStore } from '../src/lib/access/types';
import { FileAuditStore, PostgresAuditStore, type AuditStore } from '../src/lib/admin/audit';
import { sameOrigin } from '../src/lib/admin/guard';
import { adminUser } from '../src/lib/admin/view';
import { MemoryChatStore, PostgresChatStore } from '../src/lib/chat/store';
import type { ChatMessage, ChatStore } from '../src/lib/chat/types';

const T0 = Date.parse('2026-10-25T17:00:00-03:00');
const PG = process.env.TEST_DATABASE_URL;
/** Unique per run, so the shared test database never collides. */
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

afterEach(() => vi.unstubAllEnvs());

describe('administrators', () => {
  it('come only from ADMIN_EMAILS and stop counting while suspended or deleted', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'Chefe@Example.com');
    vi.stubEnv('STAFF_EMAILS', 'equipe@example.com');
    const store = new FileAccessStore();
    const chefe = await store.upsertUser({ id: 'g:1', email: 'chefe@example.com', name: 'C' });
    const equipe = await store.upsertUser({ id: 'g:2', email: 'equipe@example.com', name: 'E' });
    expect(isAdmin(chefe)).toBe(true);
    expect(isStaff(chefe)).toBe(true);
    expect(isAdmin(equipe)).toBe(false);
    expect(isStaff(equipe)).toBe(true);
    await store.setPaused('g:1', { at: T0, reason: 'teste' });
    expect(isAdmin((await store.getUser('g:1'))!)).toBe(false);
  });

  it('accept changes only from the same site', () => {
    const request = (headers: Record<string, string>) =>
      new Request('https://resultados.example/api/admin/users/x', { method: 'POST', headers });
    expect(
      sameOrigin(request({ origin: 'https://resultados.example', host: 'resultados.example' })),
    ).toBe(true);
    expect(
      sameOrigin(request({ origin: 'https://evil.example', host: 'resultados.example' })),
    ).toBe(false);
    expect(sameOrigin(request({ host: 'resultados.example' }))).toBe(false);
    expect(
      sameOrigin(
        request({
          origin: 'https://resultados.example',
          host: '10.0.0.5:3000',
          'x-forwarded-host': 'resultados.example',
        }),
      ),
    ).toBe(true);
  });
});

function accessStoreSuite(name: string, make: () => AccessStore) {
  describe(name, () => {
    it('suspends, reactivates and blocks the session', async () => {
      const store = make();
      const id = `g:pause-${run}`;
      await store.upsertUser({ id, email: `p-${run}@example.com`, name: 'Paula' });
      await store.startSession(id, 's1');
      expect(await store.setPaused(id, { at: T0, reason: 'spam no chat' })).toBe(true);
      const paused = await store.getUser(id);
      expect(paused).toMatchObject({ pausedAt: T0, pausedReason: 'spam no chat' });

      const session = { sub: id, email: paused!.email, name: 'Paula', sid: 's1' };
      const access = await currentAccess(session, store, T0, { fresh: true });
      expect(access?.blocked).toBe('paused');
      const problem = sessionProblem(access);
      expect(problem?.status).toBe(403);
      expect(await problem?.json()).toMatchObject({ code: 'paused' });

      await store.setPaused(id, null);
      expect(await store.getUser(id)).toMatchObject({ pausedAt: null, pausedReason: null });
      expect((await currentAccess(session, store, T0, { fresh: true }))?.blocked).toBeNull();
    });

    it('deletes personal data for good, even if the person signs in again', async () => {
      const store = make();
      const id = `g:del-${run}`;
      const email = `d-${run}@example.com`;
      await store.upsertUser({ id, email, name: 'Daniela' });
      await store.saveProfile(
        id,
        { username: `dani${run}`.slice(0, 20), party: 'PT', partyConsentAt: T0 },
        T0,
      );
      await store.startSession(id, 's1');
      expect(await store.anonymize(id, T0)).toBe(true);
      const gone = await store.getUser(id);
      expect(gone).toMatchObject({ deletedAt: T0, username: null, party: null, sessionId: null });
      expect(gone!.email).not.toBe(email);
      expect(gone!.name).not.toBe('Daniela');
      // The username is free again.
      expect(await store.usernameTaken(`dani${run}`.slice(0, 20))).toBe(false);
      // A new Google sign-in does not bring the data back nor reopen the account.
      const again = await store.upsertUser({ id, email, name: 'Daniela' });
      expect(again.email).not.toBe(email);
      expect(again.deletedAt).toBe(T0);
      expect(adminUser(again).deletedAt).toBe(T0);
    });

    it('searches accounts and counts them', async () => {
      const store = make();
      const before = await store.stats();
      const id = `g:search-${run}`;
      await store.upsertUser({ id, email: `busca-${run}@example.com`, name: 'Bruna' });
      await store.markPaid(id, `pay-${run}`, T0);
      const found = await store.listUsers({ query: `busca-${run}`, limit: 10, offset: 0 });
      expect(found.total).toBe(1);
      expect(found.users[0].id).toBe(id);
      expect((await store.listUsers({ query: id, limit: 10, offset: 0 })).total).toBe(1);
      expect((await store.listUsers({ query: `nada-${run}`, limit: 10, offset: 0 })).total).toBe(0);
      const after = await store.stats();
      // Other test files may write to the shared test database at the same time.
      expect(after.users).toBeGreaterThanOrEqual(before.users + 1);
      expect(after.paid).toBeGreaterThanOrEqual(before.paid + 1);
    });
  });
}

accessStoreSuite('account moderation (file store)', () => new FileAccessStore());
if (PG) accessStoreSuite('account moderation (Postgres)', () => new PostgresAccessStore(PG));

function chatStoreSuite(name: string, make: () => ChatStore) {
  describe(name, () => {
    const message = (n: number, userId: string): ChatMessage => ({
      id: `${run}m${n}`,
      userId,
      username: userId.slice(-6),
      party: null,
      photo: null,
      sticker: null,
      text: `mensagem ${n}`,
      createdAt: Date.parse('2100-01-01T00:00:00Z') + Date.now() * 10 + n,
      deletedAt: null,
    });

    it('lists reported messages, most reported first, and removes an author’s messages', async () => {
      const store = make();
      const troll = `g:troll-${run}`;
      const other = `g:other-${run}`;
      await store.add(message(1, troll));
      await store.add(message(2, troll));
      await store.add(message(3, other));
      await store.report(`${run}m1`, 'g:a', T0);
      await store.report(`${run}m3`, 'g:a', T0);
      await store.report(`${run}m3`, 'g:b', T0);
      const reported = (await store.reported(500)).filter((r) => r.message.id.startsWith(run));
      expect(reported.map((r) => [r.message.id, r.reports])).toEqual([
        [`${run}m3`, 2],
        [`${run}m1`, 1],
      ]);

      const removed = await store.removeByAuthor(troll, 'admin:x', T0);
      expect(removed.sort()).toEqual([`${run}m1`, `${run}m2`]);
      expect(await store.removeByAuthor(troll, 'admin:x', T0)).toEqual([]);
      // Deleted messages leave the moderation queue.
      const left = (await store.reported(500)).filter((r) => r.message.id.startsWith(run));
      expect(left.map((r) => r.message.id)).toEqual([`${run}m3`]);
    });
  });
}

chatStoreSuite('chat moderation (memory)', () => new MemoryChatStore());
if (PG) chatStoreSuite('chat moderation (Postgres)', () => new PostgresChatStore(PG));

function auditSuite(name: string, make: () => AuditStore) {
  describe(name, () => {
    it('keeps every action, newest first', async () => {
      const store = make();
      const base = Date.parse('2100-01-01T00:00:00Z') + Date.now() * 10;
      await store.add({
        at: base,
        admin: 'a@x',
        action: 'pause',
        target: `@${run}`,
        detail: 'spam',
      });
      await store.add({
        at: base + 1,
        admin: 'a@x',
        action: 'unpause',
        target: `@${run}`,
        detail: null,
      });
      const [latest, previous] = await store.list(2);
      expect(latest).toMatchObject({ action: 'unpause', target: `@${run}`, detail: null });
      expect(previous).toMatchObject({ action: 'pause', detail: 'spam', at: base });
    });
  });
}

auditSuite('audit log (file)', () => new FileAuditStore());
if (PG) auditSuite('audit log (Postgres)', () => new PostgresAuditStore(PG));
