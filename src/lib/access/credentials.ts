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
