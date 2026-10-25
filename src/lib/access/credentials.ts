import { cleanUsername, usernameProblem } from '@/lib/profile/username';
import {
  cleanEmail,
  emailAccountId,
  hashPassword,
  passwordProblem,
  passwordStore,
  usernameAccountId,
  verifyPassword,
  type PasswordStore,
} from './password';
import { accessStore } from './store';
import type { AccessStore } from './types';

export type CredentialResult =
  | { ok: true; profile: { sub: string; email: string; name: string } }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): CredentialResult => ({ ok: false, status, error });
const WRONG = 'Nome de usuário ou senha incorretos.';

/**
 * New account with username and password. The person still picks a party on /cadastro.
 * Team/admin accounts are not created here (they use e-mail via adminCreateAccount).
 */
export async function signUp(
  input: { username: unknown; password: unknown },
  stores: { access?: AccessStore; passwords?: PasswordStore } = {},
): Promise<CredentialResult> {
  const access = stores.access ?? accessStore(),
    passwords = stores.passwords ?? passwordStore();
  const username = cleanUsername(String(input.username ?? ''));
  const problem = usernameProblem(username);
  if (problem) return fail(400, problem);
  const password = String(input.password ?? '');
  const passProblem = passwordProblem(password);
  if (passProblem) return fail(400, passProblem);
  if (await access.usernameTaken(username))
    return fail(409, 'Esse nome já está em uso. Escolha outro.');
  const id = usernameAccountId(username);
  const existing = await access.getUser(id);
  if (existing?.deletedAt) return fail(403, 'Esta conta foi excluída.');
  if (existing) return fail(409, 'Esse nome já está em uso. Escolha outro.');
  if (!(await passwords.create(id, await hashPassword(password))))
    return fail(409, 'Esse nome já está em uso. Escolha outro.');
  await access.upsertUser({ id, email: '', name: username });
  const claimed = await access.claimUsername(id, username);
  if (claimed !== 'ok') {
    return fail(409, 'Esse nome já está em uso. Escolha outro.');
  }
  return { ok: true, profile: { sub: id, email: '', name: username } };
}

/** Signs in with the username (or legacy e-mail), plus the password. */
export async function logIn(
  input: { login: unknown; password: unknown },
  stores: { access?: AccessStore; passwords?: PasswordStore } = {},
): Promise<CredentialResult> {
  const access = stores.access ?? accessStore(),
    passwords = stores.passwords ?? passwordStore();
  const login = String(input.login ?? '')
    .trim()
    .replace(/^@/, '');
  const password = String(input.password ?? '');
  if (!login || !password || password.length > 200) return fail(400, WRONG);
  const email = login.includes('@') ? cleanEmail(login) : null;
  const id = email
    ? emailAccountId(email)
    : ((await access.userIdByUsername(login.slice(0, 40))) ??
      (usernameProblem(cleanUsername(login.slice(0, 40))) === null
        ? usernameAccountId(cleanUsername(login.slice(0, 40)))
        : null));
  const hash = id ? await passwords.get(id) : null;
  // verifyPassword does the same work without a hash, so a missing account takes as long.
  if (!(await verifyPassword(password, hash)) || !id) return fail(401, WRONG);
  const user = await access.getUser(id);
  if (!user || user.deletedAt) return fail(401, WRONG);
  return { ok: true, profile: { sub: id, email: user.email, name: user.name } };
}

/**
 * Account created by an administrator (/admin): any e-mail, including team and administrator
 * e-mails, which cannot sign up on the site. The person completes the sign-up on first login.
 */
export async function adminCreateAccount(
  input: { email: unknown; password: unknown },
  stores: { access?: AccessStore; passwords?: PasswordStore } = {},
): Promise<{ ok: true; id: string; email: string } | { ok: false; status: number; error: string }> {
  const access = stores.access ?? accessStore(),
    passwords = stores.passwords ?? passwordStore();
  const email = cleanEmail(input.email);
  if (!email) return { ok: false, status: 400, error: 'Digite um e-mail válido.' };
  const problem = passwordProblem(String(input.password ?? ''));
  if (problem) return { ok: false, status: 400, error: problem };
  const id = emailAccountId(email);
  if ((await access.getUser(id))?.deletedAt)
    return { ok: false, status: 409, error: 'Esta conta foi excluída.' };
  if (!(await passwords.create(id, await hashPassword(String(input.password)))))
    return { ok: false, status: 409, error: 'Já existe uma conta com este e-mail.' };
  await access.upsertUser({ id, email, name: email.split('@')[0] });
  // Admin-created accounts get full panel access without Mercado Pago.
  await access.markPaid(id, 'admin:grant', Date.now());
  return { ok: true, id, email };
}

/** New password for an existing account, set by an administrator. */
export async function adminSetPassword(
  id: string,
  password: unknown,
  passwords: PasswordStore = passwordStore(),
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const problem = passwordProblem(String(password ?? ''));
  if (problem) return { ok: false, status: 400, error: problem };
  await passwords.set(id, await hashPassword(String(password)));
  return { ok: true };
}
