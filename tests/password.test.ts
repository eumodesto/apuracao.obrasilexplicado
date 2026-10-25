import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logIn, signUp } from '../src/lib/access/credentials';
import { FilePasswordStore, hashPassword, verifyPassword } from '../src/lib/access/password';
import { FileAccessStore } from '../src/lib/access/store';

const stores = () => ({ access: new FileAccessStore(), passwords: new FilePasswordStore() });

describe('password hashing', () => {
  it('verifies only the right password and never stores it in clear', async () => {
    const hash = await hashPassword('virada-no-fim');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hash).not.toContain('virada');
    expect(await verifyPassword('virada-no-fim', hash)).toBe(true);
    expect(await verifyPassword('virada-no-fiM', hash)).toBe(false);
    expect(await verifyPassword('qualquer', null)).toBe(false);
    // Each hash has its own salt.
    expect(await hashPassword('virada-no-fim')).not.toBe(hash);
  });
});

describe('sign up and sign in with e-mail and password', () => {
  const saved = process.env.ADMIN_EMAILS;
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'chefe@example.com';
  });
  afterEach(() => {
    process.env.ADMIN_EMAILS = saved;
  });

  it('creates one account per e-mail and signs in by e-mail or username', async () => {
    const s = stores();
    const created = await signUp({ email: ' Ana@Example.com ', password: 'senha-forte-1' }, s);
    expect(created).toMatchObject({ ok: true, profile: { sub: 'email:ana@example.com' } });
    expect(await signUp({ email: 'ana@example.com', password: 'outra-senha-2' }, s)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await logIn({ login: 'ANA@example.com', password: 'senha-forte-1' }, s)).toMatchObject({
      ok: true,
      profile: { sub: 'email:ana@example.com', email: 'ana@example.com' },
    });
    await s.access.saveProfile(
      'email:ana@example.com',
      { username: 'AnaVota', party: 'none', partyConsentAt: null },
      Date.now(),
    );
    expect(await logIn({ login: '@anavota', password: 'senha-forte-1' }, s)).toMatchObject({
      ok: true,
    });
  });

  it('refuses wrong passwords, unknown accounts and weak passwords with the same message', async () => {
    const s = stores();
    await signUp({ email: 'bia@example.com', password: 'senha-forte-1' }, s);
    const wrong = await logIn({ login: 'bia@example.com', password: 'senha-errada' }, s);
    const unknown = await logIn({ login: 'ninguem@example.com', password: 'senha-forte-1' }, s);
    expect(wrong).toMatchObject({ ok: false, status: 401 });
    expect(unknown).toEqual(wrong);
    expect(await signUp({ email: 'cid@example.com', password: 'curta' }, s)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await signUp({ email: 'sem-arroba', password: 'senha-forte-1' }, s)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('keeps team and administrator e-mails out of self sign-up', async () => {
    const s = stores();
    expect(
      await signUp({ email: 'Chefe@example.com', password: 'senha-forte-1' }, s),
    ).toMatchObject({ ok: false, status: 403 });
    expect(await s.access.getUser('email:chefe@example.com')).toBeNull();
  });

  it('does not reopen a deleted account', async () => {
    const s = stores();
    await signUp({ email: 'dani@example.com', password: 'senha-forte-1' }, s);
    await s.access.anonymize('email:dani@example.com', Date.now());
    expect(await logIn({ login: 'dani@example.com', password: 'senha-forte-1' }, s)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await signUp({ email: 'dani@example.com', password: 'senha-forte-2' }, s)).toMatchObject(
      {
        ok: false,
        status: 403,
      },
    );
  });
});

describe('accounts created by an administrator', () => {
  const saved = process.env.ADMIN_EMAILS;
  afterEach(() => {
    process.env.ADMIN_EMAILS = saved;
  });

  it('creates team accounts the public sign-up refuses, and resets passwords', async () => {
    process.env.ADMIN_EMAILS = 'equipe@example.com';
    const { adminCreateAccount, adminSetPassword } = await import('../src/lib/access/credentials');
    const s = stores();
    expect(
      await signUp({ email: 'equipe@example.com', password: 'senha-forte-1' }, s),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await adminCreateAccount({ email: 'Equipe@Example.com', password: 'senha-forte-1' }, s),
    ).toEqual({ ok: true, id: 'email:equipe@example.com', email: 'equipe@example.com' });
    expect(await s.access.getUser('email:equipe@example.com')).toMatchObject({
      paidAt: expect.any(Number),
      paymentId: 'admin:grant',
    });
    expect(
      await adminCreateAccount({ email: 'equipe@example.com', password: 'outra-senha-2' }, s),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await logIn({ login: 'equipe@example.com', password: 'senha-forte-1' }, s),
    ).toMatchObject({ ok: true });
    expect(await adminSetPassword('email:equipe@example.com', 'curta', s.passwords)).toMatchObject({
      ok: false,
    });
    await adminSetPassword('email:equipe@example.com', 'nova-senha-3', s.passwords);
    expect(
      await logIn({ login: 'equipe@example.com', password: 'senha-forte-1' }, s),
    ).toMatchObject({ ok: false });
    expect(await logIn({ login: 'equipe@example.com', password: 'nova-senha-3' }, s)).toMatchObject(
      { ok: true },
    );
  });
});
