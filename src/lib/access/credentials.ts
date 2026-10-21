import { staffEmails } from './config';
import {
  cleanEmail,
  emailAccountId,
  hashPassword,
  passwordProblem,
  passwordStore,
  verifyPassword,
  type PasswordStore,
} from './password';
import { accessStore } from './store';
import type { AccessStore } from './types';

export type CredentialResult =
  | { ok: true; profile: { sub: string; email: string; name: string } }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): CredentialResult => ({ ok: false, status, error });
const WRONG = 'E-mail, nome de usuário ou senha incorretos.';

/**
 * New account with e-mail and password. Team and administrator e-mails cannot be claimed here:
 * nobody confirms that the person owns the e-mail, so those accounts get their password only on
 * the server (scripts/set-password.mjs).
 */
export async function signUp(
  input: { email: unknown; password: unknown },
  stores: { access?: AccessStore; passwords?: PasswordStore } = {},
): Promise<CredentialResult> {
  const access = stores.access ?? accessStore(),
    passwords = stores.passwords ?? passwordStore();
  const email = cleanEmail(input.email);
  if (!email) return fail(400, 'Digite um e-mail válido.');
  const password = String(input.password ?? '');
  const problem = passwordProblem(password);
  if (problem) return fail(400, problem);
  if (staffEmails().has(email))
    return fail(403, 'Este e-mail é reservado. Peça a senha à administração do site.');
  const id = emailAccountId(email);
  const existing = await access.getUser(id);
  if (existing?.deletedAt) return fail(403, 'Esta conta foi excluída.');
  if (!(await passwords.create(id, await hashPassword(password))))
    return fail(409, 'Já existe uma conta com este e-mail. Use "Entrar".');
  const name = email.split('@')[0];
  await access.upsertUser({ id, email, name });
  return { ok: true, profile: { sub: id, email, name } };
}

/** Signs in with the e-mail or the username, plus the password. */
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
  const id = email ? emailAccountId(email) : await access.userIdByUsername(login.slice(0, 40));
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
