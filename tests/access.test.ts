import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessStatus, watchedSeconds } from '../src/lib/access/access';
import {
  applyPayment,
  openPix,
  payWithCard,
  refreshPayment,
  webhookUrl,
} from '../src/lib/access/billing';
import { stickerProduct } from '../src/lib/access/products';
import { safeNext } from '../src/lib/access/next';
import { NO_PARTY, PARTIES, validPartyChoice } from '../src/lib/profile/parties';
import { cleanUsername, usernameProblem } from '../src/lib/profile/username';
import {
  MercadoPago,
  mercadoPagoDate,
  paymentStatus,
  validWebhookSignature,
  type MercadoPagoPayment,
} from '../src/lib/access/mercadopago';
import { sign, verify } from '../src/lib/access/signed';
import { FileAccessStore } from '../src/lib/access/store';

const T0 = Date.parse('2026-10-25T17:00:00-03:00');
const limits = { free: 300, price: 5 };
const profile = { id: 'google:1', email: 'ana@example.com', name: 'Ana' };
const blankProfile = {
  sessionId: null,
  sessionChanges: 0,
  username: null,
  party: null,
  partyConsentAt: null,
  onboardedAt: null,
  createdAt: null,
  freeStartedAt: null,
  pausedAt: null,
  pausedReason: null,
  deletedAt: null,
  photoVersion: null,
  stickerCredits: 0,
};

describe('signed tokens', () => {
  const secret = 'x'.repeat(32);
  it('round-trips and expires', () => {
    const token = sign({ sub: 'u1' }, secret, 60, T0);
    expect(verify<{ sub: string }>(token, secret, T0 + 59_000)?.sub).toBe('u1');
    expect(verify(token, secret, T0 + 60_000)).toBeNull();
  });
  it('rejects tampering and other secrets', () => {
    const token = sign({ sub: 'u1' }, secret, 60, T0);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9e9 })).toString('base64url');
    expect(verify(`${forged}.${signature}`, secret, T0)).toBeNull();
    expect(verify(`${payload}.${signature}x`, secret, T0)).toBeNull();
    expect(verify(token, 'y'.repeat(32), T0)).toBeNull();
    expect(verify(undefined, secret, T0)).toBeNull();
    expect(verify('garbage', secret, T0)).toBeNull();
  });
});

describe('free time', () => {
  it('counts gaps between requests, capped so absences do not drain the free time', () => {
    expect(watchedSeconds(null, T0, 20)).toBe(0);
    expect(watchedSeconds(T0, T0 + 3_000, 20)).toBe(3);
    expect(watchedSeconds(T0, T0 + 3_600_000, 20)).toBe(20);
    expect(watchedSeconds(T0, T0 - 5_000, 20)).toBe(0);
  });

  it('is free, then locked after five watched minutes, and paid for life after payment', () => {
    const user = {
      ...profile,
      freeSecondsUsed: 0,
      lastSeenAt: null,
      paidAt: null,
      paymentId: null,
      ...blankProfile,
    };
    expect(accessStatus(user, T0, limits)).toMatchObject({ state: 'free', remainingSeconds: 300 });
    expect(accessStatus({ ...user, freeSecondsUsed: 299.2 }, T0, limits)).toMatchObject({
      state: 'free',
      remainingSeconds: 1,
    });
    expect(accessStatus({ ...user, freeSecondsUsed: 300 }, T0, limits).state).toBe('locked');
    const paid = { ...user, freeSecondsUsed: 300, paidAt: T0 };
    expect(accessStatus(paid, T0, limits)).toMatchObject({ state: 'paid', paidUntil: null });
    // Years later the paid account is still unlocked.
    expect(accessStatus(paid, T0 + 10 * 365 * 24 * 60 * 60 * 1000, limits).state).toBe('paid');
  });

  it('accumulates watched time in the store without double counting parallel requests', async () => {
    const store = new FileAccessStore();
    await store.upsertUser(profile);
    let now = T0;
    await store.touch(profile.id, now, 20);
    for (let i = 0; i < 100; i++) {
      now += 3_000;
      // Several panels poll at once; only the wall-clock time counts.
      await Promise.all([1, 2, 3].map(() => store.touch(profile.id, now, 20)));
    }
    const user = await store.getUser(profile.id);
    expect(user!.freeSecondsUsed).toBe(300);
    expect(accessStatus(user!, now, limits).state).toBe('locked');
  });

  it('stops counting once paid and keeps name changes', async () => {
    const store = new FileAccessStore();
    await store.upsertUser(profile);
    await store.touch(profile.id, T0, 20);
    await store.markPaid(profile.id, 'p1', T0);
    await store.touch(profile.id, T0 + 10_000, 20);
    await store.upsertUser({ ...profile, name: 'Ana Souza' });
    expect(await store.getUser(profile.id)).toMatchObject({
      name: 'Ana Souza',
      freeSecondsUsed: 0,
      paidAt: T0,
      paymentId: 'p1',
    });
  });

  it('persists to its JSON file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'access-')),
      file = path.join(dir, 'access.json');
    try {
      const first = new FileAccessStore(file);
      await first.upsertUser(profile);
      await first.touch(profile.id, T0, 20);
      await first.touch(profile.id, T0 + 7_000, 20);
      expect((await new FileAccessStore(file).getUser(profile.id))?.freeSecondsUsed).toBe(7);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const remote = (overrides: Partial<MercadoPagoPayment> = {}): MercadoPagoPayment => ({
  id: '123',
  status: 'pending',
  amount: 5,
  currency: 'BRL',
  externalReference: profile.id,
  qrCode: '000201pix',
  qrCodeBase64: 'iVBOR',
  expiresAt: T0 + 30 * 60_000,
  ...overrides,
});

const fakeMercadoPago = (payment: MercadoPagoPayment) =>
  ({
    createPix: vi.fn(async () => payment),
    getPayment: vi.fn(async () => payment),
  }) as unknown as MercadoPago & {
    createPix: ReturnType<typeof vi.fn>;
    getPayment: ReturnType<typeof vi.fn>;
  };

/** Access for R$ 5, the price these tests use. */
const P5 = { purpose: 'access' as const, amount: 5, credits: null, description: 'Acesso' };

describe('Pix payment', () => {
  it('creates one charge and reuses it while it is still payable', async () => {
    const store = new FileAccessStore(),
      user = await store.upsertUser(profile),
      mp = fakeMercadoPago(remote());
    const first = await openPix(user, store, mp, T0, P5);
    expect(first).toMatchObject({ id: '123', status: 'pending', qrCode: '000201pix' });
    expect(mp.createPix).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5, email: 'ana@example.com', userId: profile.id }),
    );
    expect((await openPix(user, store, mp, T0 + 60_000, P5)).id).toBe('123');
    expect(mp.createPix).toHaveBeenCalledTimes(1);
    mp.createPix.mockResolvedValueOnce(remote({ id: '456' }));
    // Less than two minutes left: issue a fresh code.
    expect((await openPix(user, store, mp, T0 + 29 * 60_000, P5)).id).toBe('456');
  });

  it('grants access only for an approved BRL payment of the full price by the same user', async () => {
    for (const [overrides, granted] of [
      [{ status: 'approved' }, true],
      [{ status: 'pending' }, false],
      [{ status: 'approved', amount: 0.5 }, false],
      [{ status: 'approved', currency: 'USD' }, false],
      [{ status: 'approved', externalReference: 'google:2' }, false],
    ] as const) {
      const store = new FileAccessStore(),
        user = await store.upsertUser(profile);
      await openPix(user, store, fakeMercadoPago(remote()), T0, P5);
      expect(await applyPayment(remote(overrides), store, T0)).toBe(granted);
      expect((await store.getUser(profile.id))!.paidAt).toBe(granted ? T0 : null);
    }
  });

  it('ignores payments it did not create', async () => {
    const store = new FileAccessStore();
    await store.upsertUser(profile);
    expect(await applyPayment(remote({ status: 'approved' }), store, T0)).toBe(false);
    expect((await store.getUser(profile.id))!.paidAt).toBeNull();
  });

  it('confirms a pending charge by asking Mercado Pago (no webhook needed)', async () => {
    const store = new FileAccessStore(),
      user = await store.upsertUser(profile);
    await openPix(user, store, fakeMercadoPago(remote()), T0, P5);
    const payment = await refreshPayment(
      user,
      store,
      fakeMercadoPago(remote({ status: 'approved' })),
      T0,
    );
    expect(payment?.status).toBe('approved');
    expect((await store.getUser(profile.id))!.paymentId).toBe('123');
  });

  it('simulates a charge without Mercado Pago', async () => {
    const store = new FileAccessStore(),
      user = await store.upsertUser(profile);
    const payment = await openPix(user, store, null, T0, P5);
    expect(payment.id).toMatch(/^dev-/);
    expect(payment.qrCodeBase64).toBeNull();
  });

  it('maps Mercado Pago statuses', () => {
    expect(paymentStatus('approved')).toBe('approved');
    expect(paymentStatus('in_process')).toBe('pending');
    expect(paymentStatus('rejected')).toBe('rejected');
    expect(paymentStatus('refunded')).toBe('cancelled');
  });

  it('sends the Pix request Mercado Pago expects', async () => {
    const transport = vi.fn(async () =>
      Response.json({
        id: 987,
        status: 'pending',
        transaction_amount: 5,
        currency_id: 'BRL',
        external_reference: profile.id,
        date_of_expiration: '2026-10-25T17:30:00.000-03:00',
        point_of_interaction: { transaction_data: { qr_code: 'PIXCODE', qr_code_base64: 'QR' } },
      }),
    );
    const payment = await new MercadoPago('TOKEN', transport as typeof fetch).createPix({
      amount: 5,
      email: profile.email,
      userId: profile.id,
      description: 'Acesso',
      expiresAt: T0 + 30 * 60_000,
      notificationUrl: 'https://example.com/api/billing/webhook',
    });
    expect(payment).toMatchObject({ id: '987', qrCode: 'PIXCODE', qrCodeBase64: 'QR' });
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/v1/payments');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer TOKEN');
    expect(headers['X-Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual({
      transaction_amount: 5,
      description: 'Acesso',
      payment_method_id: 'pix',
      payer: { email: profile.email },
      external_reference: profile.id,
      date_of_expiration: '2026-10-25T17:30:00.000-03:00',
      notification_url: 'https://example.com/api/billing/webhook',
    });
  });

  it('formats dates in Brasília time and only sends public HTTPS webhooks', () => {
    expect(mercadoPagoDate(Date.parse('2026-10-25T20:30:00Z'))).toBe(
      '2026-10-25T17:30:00.000-03:00',
    );
    expect(webhookUrl('https://apuracao.example.com')).toBe(
      'https://apuracao.example.com/api/billing/webhook',
    );
    expect(webhookUrl('http://localhost:3000')).toBeNull();
  });

  it('verifies the webhook signature', () => {
    const secret = 'webhook-secret',
      ts = '1761422400',
      v1 = createHmac('sha256', secret).update(`id:123;request-id:req-1;ts:${ts};`).digest('hex');
    const input = { secret, requestId: 'req-1', dataId: '123' };
    expect(validWebhookSignature({ ...input, signature: `ts=${ts},v1=${v1}` })).toBe(true);
    expect(validWebhookSignature({ ...input, signature: `ts=${ts},v1=${'0'.repeat(64)}` })).toBe(
      false,
    );
    expect(validWebhookSignature({ ...input, dataId: '124', signature: `ts=${ts},v1=${v1}` })).toBe(
      false,
    );
    expect(validWebhookSignature({ ...input, signature: null })).toBe(false);
  });
});

describe('login redirect', () => {
  it('only follows same-site paths', () => {
    expect(safeNext('/?view=municipalities')).toBe('/?view=municipalities');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('election data guard', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../src/lib/access/session');
    delete (globalThis as { __accessStore?: unknown }).__accessStore;
  });

  /** Calls a guarded route as `session`, signed in with session id `sid` and signed up. */
  async function guarded(
    session: typeof profile | null,
    store: FileAccessStore,
    { sid = 's1', signedUp = true }: { sid?: string; signedUp?: boolean } = {},
  ) {
    vi.resetModules();
    if (session && !(await store.getUser(session.id))) {
      await store.upsertUser(session);
      await store.startSession(session.id, 's1');
      if (signedUp)
        await store.saveProfile(
          session.id,
          { username: session.id.replace(/\W/g, ''), party: 'none', partyConsentAt: null },
          Date.now(),
        );
    }
    vi.doMock('../src/lib/access/session', () => ({
      readSession: async () =>
        session && { sub: session.id, email: session.email, name: session.name, sid },
    }));
    (globalThis as { __accessStore?: unknown }).__accessStore = store;
    // Each call is a fresh request: no cached account from the previous one.
    delete (globalThis as { __recentAccess?: unknown }).__recentAccess;
    const { withAccess } = await import('../src/lib/access/guard');
    return withAccess(async () => Response.json({ data: true }))(new Request('http://x/'), {});
  }

  it('requires login', async () => {
    expect((await guarded(null, new FileAccessStore())).status).toBe(401);
  });

  it('serves free and paid users and refuses once the free time is used', async () => {
    const store = new FileAccessStore();
    expect((await guarded(profile, store)).status).toBe(200);
    await store.markPaid(profile.id, 'p1', Date.now());
    expect((await guarded(profile, store)).status).toBe(200);

    const other = { ...profile, id: 'google:2' },
      lockedStore = new FileAccessStore();
    await guarded(other, lockedStore);
    // Burn the free time with consecutive requests.
    let now = Date.now() - 400_000;
    for (; now < Date.now(); now += 10_000) await lockedStore.touch(other.id, now, 20);
    const response = await guarded(other, lockedStore);
    expect(response.status).toBe(402);
    expect((await response.json()).access.state).toBe('locked');
  });

  it('signs out a device once the account logs in on another one', async () => {
    const store = new FileAccessStore();
    expect((await guarded(profile, store)).status).toBe(200);
    // Another device logs in: its session id replaces s1.
    await store.startSession(profile.id, 's2');
    const old = await guarded(profile, store, { sid: 's1' });
    expect(old.status).toBe(401);
    expect((await old.json()).code).toBe('replaced');
    expect((await guarded(profile, store, { sid: 's2' })).status).toBe(200);
    expect((await store.getUser(profile.id))!.sessionChanges).toBe(1);
  });

  it('refuses cookies from before session ids existed', async () => {
    const store = new FileAccessStore();
    await guarded(profile, store);
    expect((await guarded(profile, store, { sid: '' })).status).toBe(401);
  });

  it('asks for the sign-up before serving data', async () => {
    const response = await guarded(profile, new FileAccessStore(), { signedUp: false });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('onboarding');
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('Postgres store', () => {
  it('counts time atomically, records payments and grants access once', async () => {
    const { PostgresAccessStore } = await import('../src/lib/access/store');
    const store = new PostgresAccessStore(process.env.TEST_DATABASE_URL!),
      id = `test:${T0}:${Math.random()}`;
    // Concurrent first use must not race on table creation.
    await Promise.all([store.getUser('none'), store.latestPayment('none')]);
    await store.upsertUser({ ...profile, id });
    let now = T0;
    await store.touch(id, now, 20);
    for (let i = 0; i < 10; i++) {
      now += 3_000;
      await Promise.all([1, 2, 3].map(() => store.touch(id, now, 20)));
    }
    now += 3_600_000;
    const user = await store.touch(id, now, 20);
    expect(user).toMatchObject({ id, freeSecondsUsed: 50, lastSeenAt: now, paidAt: null });
    // Before the count starts, activity is recorded but no free time is spent.
    now += 10_000;
    expect(await store.touch(id, now, 20, false)).toMatchObject({
      freeSecondsUsed: 50,
      lastSeenAt: now,
    });

    const payment = {
      id: `pay-${id}`,
      userId: id,
      status: 'pending' as const,
      amount: 5,
      qrCode: '000201',
      qrCodeBase64: null,
      expiresAt: now + 1_800_000,
      createdAt: now,
      purpose: 'access' as const,
      method: 'pix' as const,
      credits: null,
    };
    await store.savePayment(payment);
    expect(await store.latestPayment(id)).toEqual(payment);
    await store.setPaymentStatus(payment.id, 'approved');
    await store.markPaid(id, payment.id, now);
    await store.markPaid(id, 'other', now + 1);
    await store.touch(id, now + 5_000, 20);
    expect(await store.getPayment(payment.id)).toMatchObject({ status: 'approved', amount: 5 });
    expect(await store.getUser(id)).toMatchObject({
      freeSecondsUsed: 50,
      paidAt: now,
      paymentId: payment.id,
    });
  });

  it('keeps one session per account and unique usernames', async () => {
    const { PostgresAccessStore } = await import('../src/lib/access/store');
    const store = new PostgresAccessStore(process.env.TEST_DATABASE_URL!),
      run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`,
      a = `test:a:${run}`,
      b = `test:b:${run}`;
    await store.upsertUser({ ...profile, id: a });
    await store.upsertUser({ ...profile, id: b });
    await store.startSession(a, 's1');
    await store.startSession(a, 's1');
    await store.startSession(a, 's2');
    expect(await store.getUser(a)).toMatchObject({ sessionId: 's2', sessionChanges: 1 });
    const name = `Pg_${run}`.slice(0, 20);
    expect(
      await store.saveProfile(a, { username: name, party: 'PL', partyConsentAt: T0 }, T0),
    ).toBe('ok');
    expect(
      await store.saveProfile(
        b,
        { username: name.toLowerCase(), party: NO_PARTY, partyConsentAt: null },
        T0,
      ),
    ).toBe('taken');
    expect(await store.usernameTaken(name.toUpperCase())).toBe(true);
    expect(await store.usernameTaken(name, a)).toBe(false);
    expect(await store.getUser(a)).toMatchObject({
      username: name,
      party: 'PL',
      partyConsentAt: T0,
      onboardedAt: T0,
      lastSeenAt: null,
    });
    expect(
      await store.saveProfile(
        `test:none:${run}`,
        { username: 'x_y_z', party: NO_PARTY, partyConsentAt: null },
        T0,
      ),
    ).toBe('missing');
  });
});

describe('free time setting', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('defaults to one minute, also when the variable is empty, and accepts overrides', async () => {
    const { freeSeconds } = await import('../src/lib/access/config');
    vi.stubEnv('FREE_SECONDS', undefined);
    expect(freeSeconds()).toBe(60);
    vi.stubEnv('FREE_SECONDS', '');
    expect(freeSeconds()).toBe(60);
    vi.stubEnv('FREE_SECONDS', '30');
    expect(freeSeconds()).toBe(30);
    vi.stubEnv('FREE_SECONDS', '0');
    expect(freeSeconds()).toBe(0);
  });
});

describe('free time before the count starts', () => {
  it('does not spend free time while results are not published, and resumes once they are', async () => {
    const store = new FileAccessStore();
    await store.upsertUser(profile);
    await store.touch(profile.id, T0, 20, false);
    await store.touch(profile.id, T0 + 10_000, 20, false);
    expect((await store.getUser(profile.id))!.freeSecondsUsed).toBe(0);
    await store.touch(profile.id, T0 + 20_000, 20, true);
    expect((await store.getUser(profile.id))!.freeSecondsUsed).toBe(10);
  });

  it('reports the waiting state to the panel, but never for paid users', () => {
    const user = {
      ...profile,
      freeSecondsUsed: 0,
      lastSeenAt: null,
      paidAt: null,
      paymentId: null,
      ...blankProfile,
    };
    expect(accessStatus(user, T0, limits, true)).toMatchObject({ state: 'free', waiting: true });
    expect(accessStatus({ ...user, paidAt: T0 }, T0, limits, true).waiting).toBe(false);
  });
});

describe('activity writes at peak', () => {
  it('writes at most once per interval per user and still counts the whole time', async () => {
    const { currentAccess, TOUCH_INTERVAL_MS } = await import('../src/lib/access/guard');
    const store = new FileAccessStore(),
      touch = vi.spyOn(store, 'touch'),
      session = { sub: 'google:peak', email: 'peak@example.com', name: 'Peak' };
    await store.upsertUser({ id: session.sub, email: session.email, name: session.name });
    let now = T0;
    for (let i = 0; i < 40; i++, now += 1_000)
      await currentAccess(session, store, now, { started: true });
    // 40 requests over 40 s: one write per 5 s window instead of 40.
    expect(touch.mock.calls.length).toBeLessThanOrEqual(40_000 / TOUCH_INTERVAL_MS + 1);
    const fresh = await currentAccess(session, store, now, { started: true, fresh: true });
    expect(fresh!.user.freeSecondsUsed).toBe(40);
  });

  it('only re-reads paid accounts every 30 s and writes their last visit every 5 min', async () => {
    const { currentAccess, PAID_CHECK_MS, PAID_TOUCH_MS } = await import('../src/lib/access/guard');
    const store = new FileAccessStore(),
      session = { sub: 'google:paid-peak', email: 'pago@example.com', name: 'Pago' };
    await store.upsertUser({ id: session.sub, email: session.email, name: session.name });
    await store.markPaid(session.sub, 'pay-1', T0);
    await currentAccess(session, store, T0, { started: true });
    const touch = vi.spyOn(store, 'touch'),
      read = vi.spyOn(store, 'getUser');
    // Ten minutes of requests every 10 s, heartbeats included.
    for (let now = T0 + 10_000; now <= T0 + 10 * 60_000; now += 10_000)
      await currentAccess(session, store, now, { started: true, fresh: true });
    expect(touch.mock.calls.length).toBe((10 * 60_000) / PAID_TOUCH_MS);
    expect(read.mock.calls.length + touch.mock.calls.length).toBeLessThanOrEqual(
      (10 * 60_000) / PAID_CHECK_MS,
    );
  });
});

describe('open access for testing', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('gives everyone full access while OPEN_ACCESS=true, and only then', () => {
    const user = {
      ...profile,
      ...blankProfile,
      freeSecondsUsed: 9_999,
      lastSeenAt: null,
      paidAt: null,
      paymentId: null,
    };
    expect(accessStatus(user, T0, limits).state).toBe('locked');
    vi.stubEnv('OPEN_ACCESS', 'true');
    expect(accessStatus(user, T0, limits).state).toBe('paid');
    vi.stubEnv('OPEN_ACCESS', 'false');
    expect(accessStatus(user, T0, limits).state).toBe('locked');
  });
});

describe('team access', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('gives STAFF_EMAILS full access without free time or payment, ignoring case', async () => {
    const { staffEmails } = await import('../src/lib/access/config');
    vi.stubEnv('STAFF_EMAILS', ' Dono@Example.com , outra@example.com,');
    const staff = staffEmails();
    expect([...staff]).toEqual(['dono@example.com', 'outra@example.com']);
    const user = {
      ...profile,
      email: 'DONO@example.com',
      freeSecondsUsed: 9999,
      lastSeenAt: null,
      paidAt: null,
      paymentId: null,
      ...blankProfile,
    };
    expect(
      accessStatus(user, T0, limits, false, staff.has(user.email.toLowerCase())),
    ).toMatchObject({
      state: 'paid',
      staff: true,
    });
    vi.stubEnv('STAFF_EMAILS', '');
    expect(accessStatus(user, T0, limits).state).toBe('locked');
  });
});

describe('sign-up profile', () => {
  it('accepts ordinary usernames', () => {
    for (const name of ['ana', 'joao.silva', 'Maria_2026', 'computador', 'enviado', 'disputa'])
      expect(usernameProblem(name), name).toBeNull();
    expect(cleanUsername('  @ana.souza ')).toBe('ana.souza');
  });

  it('rejects malformed, reserved and offensive usernames', () => {
    for (const name of [
      'ab',
      'a'.repeat(21),
      'joão',
      'ana souza',
      '.ana',
      'ana_',
      'a..b',
      '12345',
      'admin',
      'Admin2026',
      'ad.min',
      'equipe_oficial',
      'tse',
      'lula',
      'lula13',
      'Bolsonaro',
      'flavio.bolsonaro',
      'caralho',
      'car4lho',
      'puta',
      'Puta123',
      'v1ado',
    ])
      expect(usernameProblem(name), name).not.toBeNull();
  });

  it('keeps usernames unique without regard to case', async () => {
    const store = new FileAccessStore();
    await store.upsertUser(profile);
    await store.upsertUser({ ...profile, id: 'google:2' });
    const input = { username: 'Ana.Souza', party: 'PT', partyConsentAt: T0 };
    expect(await store.saveProfile(profile.id, input, T0)).toBe('ok');
    expect(await store.saveProfile('google:2', { ...input, username: 'ana.souza' }, T0)).toBe(
      'taken',
    );
    expect(await store.usernameTaken('ANA.SOUZA')).toBe(true);
    expect(await store.usernameTaken('ana.souza', profile.id)).toBe(false);
    // Saving again (e.g. changing the party) keeps the same name.
    expect(
      await store.saveProfile(
        profile.id,
        { ...input, party: NO_PARTY, partyConsentAt: null },
        T0 + 1,
      ),
    ).toBe('ok');
    expect(await store.getUser(profile.id)).toMatchObject({
      username: 'Ana.Souza',
      party: NO_PARTY,
      partyConsentAt: null,
      onboardedAt: T0,
    });
    expect(await store.saveProfile('missing', input, T0)).toBe('missing');
  });

  it('does not count the time spent filling the form as free time', async () => {
    const store = new FileAccessStore();
    await store.upsertUser(profile);
    await store.touch(profile.id, T0, 20);
    await store.saveProfile(
      profile.id,
      { username: 'ana', party: NO_PARTY, partyConsentAt: null },
      T0 + 60_000,
    );
    await store.touch(profile.id, T0 + 61_000, 20);
    expect((await store.getUser(profile.id))!.freeSecondsUsed).toBe(0);
  });

  it('offers only the two 2nd-round parties, 13 and 22, plus "Prefiro não informar"', () => {
    expect(PARTIES.map((p) => p.number)).toEqual(['13', '22']);
    expect(validPartyChoice(NO_PARTY)).toBe(true);
    expect(validPartyChoice('PT')).toBe(true);
    expect(validPartyChoice('PL')).toBe(true);
    expect(validPartyChoice('MDB')).toBe(false);
    expect(new Set(PARTIES.map((p) => p.code)).size).toBe(PARTIES.length);
    expect(PARTIES.every((p) => /^#[0-9a-f]{6}$/i.test(p.color))).toBe(true);
  });
});

describe('sticker packs and card payments', () => {
  it('adds a pack once, even when the webhook and the polling both see the approval', async () => {
    const store = new FileAccessStore(),
      user = await store.upsertUser(profile);
    const pack = stickerProduct('s20')!;
    expect(pack).toMatchObject({ purpose: 'stickers', amount: 3.5, credits: 20 });
    expect(stickerProduct('s10')).toMatchObject({ amount: 3, credits: 10 });
    expect(stickerProduct('s30')).toMatchObject({ amount: 4, credits: 30 });
    expect(stickerProduct('s50')).toMatchObject({ amount: 5, credits: 50 });
    expect(stickerProduct('s5')).toBeNull();
    expect(stickerProduct('s999')).toBeNull();
    await openPix(user, store, fakeMercadoPago(remote({ amount: 3.5 })), T0, pack);
    const approved = remote({ status: 'approved', amount: 3.5 });
    expect(await applyPayment(approved, store, T0)).toBe(true);
    expect(await applyPayment(approved, store, T0 + 1)).toBe(true);
    const after = (await store.getUser(profile.id))!;
    expect(after.stickerCredits).toBe(20);
    // A sticker pack does not pay for access.
    expect(after.paidAt).toBeNull();
  });

  it('refuses a pack paid with less than its price', async () => {
    const store = new FileAccessStore(),
      user = await store.upsertUser(profile);
    await openPix(user, store, fakeMercadoPago(remote({ amount: 5 })), T0, stickerProduct('s50')!);
    expect(await applyPayment(remote({ status: 'approved', amount: 2 }), store, T0)).toBe(false);
    expect((await store.getUser(profile.id))!.stickerCredits).toBe(0);
  });

  it('spends stickers one by one and stops at zero', async () => {
    const store = new FileAccessStore();
    await store.upsertUser(profile);
    await store.addStickerCredits(profile.id, 2);
    expect(await store.useStickerCredit(profile.id)).toBe(1);
    expect(await store.useStickerCredit(profile.id)).toBe(0);
    expect(await store.useStickerCredit(profile.id)).toBeNull();
    expect((await store.getUser(profile.id))!.stickerCredits).toBe(0);
  });

  it('charges the product price on the card, never an amount from the browser', async () => {
    const store = new FileAccessStore(),
      user = await store.upsertUser(profile);
    const createCard = vi.fn(async () =>
      remote({ id: 'card-1', status: 'approved', amount: 5, qrCode: null }),
    );
    const mp = { createCard } as unknown as MercadoPago;
    const card = {
      token: 'tok',
      installments: 1,
      paymentMethodId: 'visa',
      issuerId: null,
      identification: null,
    };
    expect(await payWithCard(user, store, mp, card, P5, T0)).toMatchObject({ status: 'approved' });
    expect(createCard).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5, userId: profile.id }),
    );
    expect((await store.getUser(profile.id))!.paidAt).toBe(T0);
    expect(await store.getPayment('card-1')).toMatchObject({ method: 'card', status: 'approved' });
  });

  it('keeps a declined card unpaid', async () => {
    const store = new FileAccessStore(),
      user = await store.upsertUser(profile);
    const mp = {
      createCard: vi.fn(async () =>
        remote({
          id: 'card-2',
          status: 'rejected',
          statusDetail: 'cc_rejected_insufficient_amount',
        }),
      ),
    } as unknown as MercadoPago;
    const result = await payWithCard(
      user,
      store,
      mp,
      {
        token: 't',
        installments: 1,
        paymentMethodId: 'visa',
        issuerId: null,
        identification: null,
      },
      P5,
      T0,
    );
    expect(result).toMatchObject({ status: 'rejected', detail: 'cc_rejected_insufficient_amount' });
    expect((await store.getUser(profile.id))!.paidAt).toBeNull();
  });
});

describe('visitors without an account', () => {
  it('creates visitors with unique names and carries their free time into an account', async () => {
    const { guestName } = await import('../src/lib/access/guest');
    const { isGuest } = await import('../src/lib/access/access');
    expect(guestName()).toMatch(/^Visitante \d{4}$/);
    const store = new FileAccessStore();
    expect(await store.createGuest('guest:a', 'Visitante 1234', T0)).toBe('ok');
    expect(await store.createGuest('guest:b', 'visitante 1234', T0)).toBe('taken');
    const visitor = (await store.getUser('guest:a'))!;
    expect(isGuest(visitor)).toBe(true);
    expect(visitor).toMatchObject({ name: 'Visitante', onboardedAt: T0, paidAt: null });
    // The visitor watched the whole minute, then creates an account: no second minute.
    await store.upsertUser(profile);
    await store.inheritFreeTime(profile.id, 60);
    await store.inheritFreeTime(profile.id, 10);
    expect((await store.getUser(profile.id))!.freeSecondsUsed).toBe(60);
    expect(
      accessStatus((await store.getUser(profile.id))!, T0, { ...limits, free: 60 }).state,
    ).toBe('locked');
  });

  it('keeps visitor free time across gaps without burning the minute while away', async () => {
    const store = new FileAccessStore();
    expect(await store.createGuest('guest:clock', 'Visitante 9999', T0)).toBe('ok');
    await store.touch('guest:clock', T0, 30, true);
    await store.touch('guest:clock', T0 + 20_000, 30, true);
    expect((await store.getUser('guest:clock'))!).toMatchObject({
      freeStartedAt: T0,
      freeSecondsUsed: 20,
    });
    // Away for minutes: only the capped gap counts, so the free minute is not emptied offline.
    await store.touch('guest:clock', T0 + 10 * 60_000, 30, true);
    const afterAway = (await store.getUser('guest:clock'))!;
    expect(afterAway.freeSecondsUsed).toBe(50);
    expect(accessStatus(afterAway, T0 + 10 * 60_000, { free: 60, price: 5 })).toMatchObject({
      state: 'free',
      remainingSeconds: 10,
    });
  });

  it('shares free-minute usage across IP and device so a new browser profile stays locked', async () => {
    const store = new FileAccessStore();
    await store.bumpFreeQuota(['ip:1.2.3.4', 'dev:abc'], 60);
    expect(await store.maxFreeQuota(['ip:1.2.3.4'])).toBe(60);
    expect(await store.maxFreeQuota(['dev:other'])).toBe(0);
    expect(await store.createGuest('guest:b', 'Visitante 7777', T0)).toBe('ok');
    await store.inheritFreeTime('guest:b', await store.maxFreeQuota(['ip:1.2.3.4']));
    expect(accessStatus((await store.getUser('guest:b'))!, T0, { free: 60, price: 5 }).state).toBe(
      'locked',
    );
  });

  it('keeps people from taking a name that looks like a visitor', () => {
    expect(usernameProblem('visitante1234')).not.toBeNull();
  });
});
