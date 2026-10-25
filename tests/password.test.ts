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
    const created = await signUp(
      { username: 'AnaVota', password: 'a', email: 'ana@example.com' },
      s,
    );
    expect(created).toMatchObject({
      ok: true,
      profile: { sub: 'user:anavota', name: 'AnaVota', email: 'ana@example.com' },
    });
    expect(await s.access.getUser('user:anavota')).toMatchObject({
      username: 'AnaVota',
      email: 'ana@example.com',
      onboardedAt: null,
    });
    expect(
      await signUp({ username: 'anavota', password: 'outra', email: 'outra@example.com' }, s),
    ).toMatchObject({
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
    await signUp({ username: 'bia_vota', password: 'x', email: 'bia@example.com' }, s);
    const wrong = await logIn({ login: 'bia_vota', password: 'errada' }, s);
    const unknown = await logIn({ login: 'ninguem_aqui', password: 'x' }, s);
    expect(wrong).toMatchObject({ ok: false, status: 401 });
    expect(unknown).toEqual(wrong);
  });

  it('refuses empty passwords, invalid usernames and missing e-mail', async () => {
    const s = stores();
    expect(
      await signUp({ username: 'cid_vota', password: '', email: 'cid@example.com' }, s),
    ).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await signUp({ username: 'ab', password: 'x', email: 'ab@example.com' }, s)).toMatchObject(
      {
        ok: false,
        status: 400,
      },
    );
    expect(
      await signUp({ username: 'admin', password: 'x', email: 'admin@example.com' }, s),
    ).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await signUp({ username: 'eva_vota', password: 'x', email: '' }, s)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('does not reopen a deleted account', async () => {
    const s = stores();
    await signUp({ username: 'dani_vota', password: 'x', email: 'dani@example.com' }, s);
    await s.access.anonymize('user:dani_vota', Date.now());
    expect(await logIn({ login: 'dani_vota', password: 'x' }, s)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      await signUp({ username: 'dani_vota', password: 'y', email: 'dani2@example.com' }, s),
    ).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe('e-mail checked before it reaches Mercado Pago', () => {
  it('accepts real addresses and rejects typos, placeholders and bad formats', async () => {
    const { checkEmail } = await import('../src/lib/access/password');
    expect(checkEmail(' Ana.Souza+x@Gmail.com ')).toEqual({ ok: true, email: 'ana.souza+x@gmail.com' });
    expect(checkEmail('ana@empresa.com.br')).toMatchObject({ ok: true });
    expect(checkEmail('ana@gmai.com')).toEqual({
      ok: false,
      error: 'Confira o e-mail: você quis dizer ana@gmail.com?',
    });
    expect(checkEmail('ana@hotmail.con')).toMatchObject({ ok: false });
    for (const bad of ['', 'ana', 'ana@', '@x.com', 'a..b@x.com', 'ana@x', 'ana@x.c', 'ana@@x.com'])
      expect(checkEmail(bad)).toMatchObject({ ok: false });
    expect(checkEmail('ana@pagadores.portaleleicao.com.br')).toMatchObject({ ok: false });
  });

  it('is required for admin-created accounts', async () => {
    const { adminCreateAccount } = await import('../src/lib/access/credentials');
    const s = stores();
    for (const email of ['', 'sem-arroba', 'x@gmai.com'])
      expect(
        await adminCreateAccount({ username: 'SemEmail', email, password: 'senhaforte' }, s),
      ).toMatchObject({ ok: false, status: 400 });
    expect(await s.access.getUser('user:sememail')).toBeNull();
  });
});

describe('accounts created by an administrator', () => {
  const saved = process.env.ADMIN_EMAILS;
  afterEach(() => {
    process.env.ADMIN_EMAILS = saved;
  });

  it('creates unlocked username accounts and resets passwords', async () => {
    const { adminCreateAccount, adminSetPassword } = await import('../src/lib/access/credentials');
    const s = stores();
    expect(await adminCreateAccount(
        { username: 'EquipeUm', email: 'Equipe.Um@Example.com', password: 'senhaforte' },
        s,
      )).toEqual({
      ok: true,
      id: 'user:equipeum',
      username: 'EquipeUm',
    });
    const created = await s.access.getUser('user:equipeum');
    expect(created).toMatchObject({
      username: 'EquipeUm',
      email: 'equipe.um@example.com',
      paidAt: expect.any(Number),
      paymentId: 'admin:grant',
    });
    const { accessStatus, isGrantedAccess } = await import('../src/lib/access/access');
    expect(isGrantedAccess(created!)).toBe(true);
    expect(accessStatus(created!, Date.now())).toMatchObject({
      state: 'paid',
      granted: true,
      staff: false,
    });
    expect(
      await adminCreateAccount(
        { username: 'equipeum', email: 'outro@example.com', password: 'outrasenha' },
        s,
      ),
    ).toMatchObject({ ok: false, status: 409 });
    expect(await logIn({ login: 'EquipeUm', password: 'senhaforte' }, s)).toMatchObject({
      ok: true,
    });
    expect(await adminSetPassword('user:equipeum', '', s.passwords)).toMatchObject({
      ok: false,
    });
    await adminSetPassword('user:equipeum', 'novasenha1', s.passwords);
    expect(await logIn({ login: 'EquipeUm', password: 'senhaforte' }, s)).toMatchObject({
      ok: false,
    });
    expect(await logIn({ login: 'EquipeUm', password: 'novasenha1' }, s)).toMatchObject({
      ok: true,
    });
  });
});
