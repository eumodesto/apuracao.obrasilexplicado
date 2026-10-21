#!/usr/bin/env node
/**
 * Sets (or resets) the password of an account, on the server. The only way to give a password to
 * team and administrator e-mails (STAFF_EMAILS / ADMIN_EMAILS), which cannot sign up on the site,
 * and to help someone who forgot theirs. Signs the account out of every device.
 *
 *   docker compose --env-file .env.production exec app node scripts/set-password.mjs pessoa@exemplo.com
 *
 * The password is typed at the prompt (hidden), never passed as an argument.
 * Same hash format as src/lib/access/password.ts.
 */
import { randomBytes, scrypt } from 'node:crypto';
import { createInterface } from 'node:readline';
import postgres from 'postgres';

const email = String(process.argv[2] ?? '')
  .trim()
  .toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Uso: node scripts/set-password.mjs pessoa@exemplo.com');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não está definida.');
  process.exit(1);
}

// One reader for both questions; what is typed is not shown.
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: !!process.stdin.isTTY,
});
const lines = rl[Symbol.asyncIterator]();
let prompt = '';
rl._writeToOutput = (text) => {
  if (text.includes(prompt)) process.stdout.write(prompt);
};
async function ask(question) {
  prompt = question;
  process.stdout.write(question);
  const { value } = await lines.next();
  process.stdout.write('\n');
  return value ?? '';
}

const password = await ask('Nova senha (mínimo 8 caracteres): ');
const repeated = await ask('Repita a senha: ');
rl.close();
if (password.length < 8 || password.length > 200) {
  console.error('A senha precisa ter de 8 a 200 caracteres.');
  process.exit(1);
}
if (repeated !== password) {
  console.error('As senhas não são iguais.');
  process.exit(1);
}

const salt = randomBytes(16);
const key = await new Promise((resolve, reject) =>
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, value) =>
    error ? reject(error) : resolve(value),
  ),
);
const hash = ['scrypt', 16384, 8, 1, salt.toString('base64url'), key.toString('base64url')].join(
  '$',
);

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
const id = `email:${email}`;
try {
  // Same tables the app creates on first use, for a fresh database.
  await sql`CREATE TABLE IF NOT EXISTS access_users (
    id text PRIMARY KEY, email text NOT NULL, name text NOT NULL,
    free_seconds_used double precision NOT NULL DEFAULT 0, last_seen_at timestamptz,
    paid_at timestamptz, payment_id text, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE access_users ADD COLUMN IF NOT EXISTS session_id text`;
  await sql`CREATE TABLE IF NOT EXISTS access_passwords (
    user_id text PRIMARY KEY, hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  const [user] = await sql`
    INSERT INTO access_users (id, email, name) VALUES (${id}, ${email}, ${email.split('@')[0]})
    ON CONFLICT (id) DO UPDATE SET session_id = NULL
    RETURNING (xmax = 0) AS created`;
  await sql`
    INSERT INTO access_passwords (user_id, hash) VALUES (${id}, ${hash})
    ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`;
  console.log(
    user.created
      ? `Conta ${email} criada com a senha. No primeiro acesso, a pessoa escolhe o nome de usuário.`
      : `Senha de ${email} trocada. A conta foi desconectada de todos os aparelhos.`,
  );
} finally {
  await sql.end();
}
