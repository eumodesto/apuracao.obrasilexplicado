import { cleanUsername, usernameProblem } from '@/lib/profile/username';
import {
  checkEmail,
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
 * New account with username, e-mail and password. The person still picks a party on /cadastro.
 * Team/admin e-mails are not created here (use `scripts/set-password.mjs`).
 */
export async function signUp(
  input: { username: unknown; password: unknown; email: unknown },
  stores: { access?: AccessStore; passwords?: PasswordStore } = {},
): Promise<CredentialResult> {
  const access = stores.access ?? accessStore(),
    passwords = stores.passwords ?? passwordStore();
  const username = cleanUsername(String(input.username ?? ''));
  const problem = usernameProblem(username);
  if (problem) return fail(400, problem);
  const checked = checkEmail(input.email);
  if (!checked.ok) return fail(400, checked.error);
  const email = checked.email;
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
  await access.upsertUser({ id, email, name: username });
  const claimed = await access.claimUsername(id, username);
  if (claimed !== 'ok') {
    return fail(409, 'Esse nome já está em uso. Escolha outro.');
  }
  return { ok: true, profile: { sub: id, email, name: username } };
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
 * Account created by an administrator (/admin): username, e-mail and password, with panel access
 * already unlocked (no Mercado Pago charge). The e-mail is kept on the account so any later
 * purchase (stickers) goes to Mercado Pago with a real payer. The person still picks a party on
 * /cadastro at first login. Team/admin e-mails stay on `scripts/set-password.mjs`.
 */
export async function adminCreateAccount(
  input: { username: unknown; password: unknown; email: unknown },
  stores: { access?: AccessStore; passwords?: PasswordStore } = {},
): Promise<
  { ok: true; id: string; username: string } | { ok: false; status: number; error: string }
> {
  const access = stores.access ?? accessStore(),
    passwords = stores.passwords ?? passwordStore();
  const username = cleanUsername(String(input.username ?? ''));
  const nameProblem = usernameProblem(username);
  if (nameProblem) return { ok: false, status: 400, error: nameProblem };
  const checked = checkEmail(input.email);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const problem = passwordProblem(String(input.password ?? ''));
  if (problem) return { ok: false, status: 400, error: problem };
  if (await access.usernameTaken(username))
    return { ok: false, status: 409, error: 'Esse nome já está em uso. Escolha outro.' };
  const id = usernameAccountId(username);
  if ((await access.getUser(id))?.deletedAt)
    return { ok: false, status: 409, error: 'Esta conta foi excluída.' };
  if (await access.getUser(id))
    return { ok: false, status: 409, error: 'Esse nome já está em uso. Escolha outro.' };
  if (!(await passwords.create(id, await hashPassword(String(input.password)))))
    return { ok: false, status: 409, error: 'Esse nome já está em uso. Escolha outro.' };
  await access.upsertUser({ id, email: checked.email, name: username });
  const claimed = await access.claimUsername(id, username);
  if (claimed !== 'ok')
    return { ok: false, status: 409, error: 'Esse nome já está em uso. Escolha outro.' };
  await access.markPaid(id, 'admin:grant', Date.now());
  return { ok: true, id, username };
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
