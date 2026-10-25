import { afterEach, describe, expect, it } from 'vitest';
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

describe('sign up and sign in with username and password', () => {
  it('creates one account per username and signs in by username', async () => {
    const s = stores();
    const created = await signUp({ username: 'AnaVota', password: 'a' }, s);
    expect(created).toMatchObject({ ok: true, profile: { sub: 'user:anavota', name: 'AnaVota' } });
    expect(await s.access.getUser('user:anavota')).toMatchObject({
      username: 'AnaVota',
      onboardedAt: null,
    });
    expect(await signUp({ username: 'anavota', password: 'outra' }, s)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await logIn({ login: '@AnaVota', password: 'a' }, s)).toMatchObject({
      ok: true,
      profile: { sub: 'user:anavota' },
    });
  });

  it('refuses wrong passwords and unknown accounts with the same message', async () => {
    const s = stores();
    await signUp({ username: 'bia_vota', password: 'x' }, s);
    const wrong = await logIn({ login: 'bia_vota', password: 'errada' }, s);
    const unknown = await logIn({ login: 'ninguem_aqui', password: 'x' }, s);
    expect(wrong).toMatchObject({ ok: false, status: 401 });
    expect(unknown).toEqual(wrong);
  });

  it('refuses empty passwords and invalid usernames', async () => {
    const s = stores();
    expect(await signUp({ username: 'cid_vota', password: '' }, s)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await signUp({ username: 'ab', password: 'x' }, s)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await signUp({ username: 'admin', password: 'x' }, s)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('does not reopen a deleted account', async () => {
    const s = stores();
    await signUp({ username: 'dani_vota', password: 'x' }, s);
    await s.access.anonymize('user:dani_vota', Date.now());
    expect(await logIn({ login: 'dani_vota', password: 'x' }, s)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await signUp({ username: 'dani_vota', password: 'y' }, s)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe('accounts created by an administrator', () => {
  const saved = process.env.ADMIN_EMAILS;
  afterEach(() => {
    process.env.ADMIN_EMAILS = saved;
  });

  it('creates team accounts by e-mail and resets passwords', async () => {
    process.env.ADMIN_EMAILS = 'equipe@example.com';
    const { adminCreateAccount, adminSetPassword } = await import('../src/lib/access/credentials');
    const s = stores();
    expect(
      await adminCreateAccount({ email: 'Equipe@Example.com', password: 'x' }, s),
    ).toEqual({ ok: true, id: 'email:equipe@example.com', email: 'equipe@example.com' });
    expect(await s.access.getUser('email:equipe@example.com')).toMatchObject({
      paidAt: expect.any(Number),
      paymentId: 'admin:grant',
    });
    expect(
      await adminCreateAccount({ email: 'equipe@example.com', password: 'outra' }, s),
    ).toMatchObject({ ok: false, status: 409 });
    expect(await logIn({ login: 'equipe@example.com', password: 'x' }, s)).toMatchObject({
      ok: true,
    });
    expect(await adminSetPassword('email:equipe@example.com', '', s.passwords)).toMatchObject({
      ok: false,
    });
    await adminSetPassword('email:equipe@example.com', 'nova', s.passwords);
    expect(await logIn({ login: 'equipe@example.com', password: 'x' }, s)).toMatchObject({
      ok: false,
    });
    expect(await logIn({ login: 'equipe@example.com', password: 'nova' }, s)).toMatchObject({
      ok: true,
    });
  });
});
