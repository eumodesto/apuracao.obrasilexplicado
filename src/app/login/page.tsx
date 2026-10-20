import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { brl, duration } from '@/features/access/format';
import { devLoginEnabled, freeSeconds, googleConfig, priceBrl } from '@/lib/access/config';
import { readSession } from '@/lib/access/session';
import './login.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Entrar — Resultados Brasil', robots: { index: false } };
const errors: Record<string, string> = {
  login: 'Não foi possível entrar com o Google. Tente novamente.',
  config: 'O login ainda não está disponível.',
};
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (await readSession()) redirect('/');
  const { erro } = await searchParams;
  return (
    <main className="login" id="conteudo">
      <section className="login-card" aria-labelledby="login-title">
        <p className="login-eyebrow">Resultados Brasil · Eleições 2026</p>
        <h1 id="login-title">Acompanhe a apuração ao vivo</h1>
        <p className="login-text">
          Resultados oficiais do TSE para Presidente, com mapa por estado, município e zona
          eleitoral.
        </p>
        <p className="login-offer">
          Você tem <b>{duration(freeSeconds())} grátis</b>. Depois, {brl(priceBrl())} no Pix liberam
          a apuração completa até o resultado final.
        </p>
        {erro && errors[erro] && (
          <p className="login-error" role="alert">
            {errors[erro]}
          </p>
        )}
        {googleConfig() ? (
          <a className="login-google" href="/api/auth/google">
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#FFC107"
                d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"
              />
              <path
                fill="#FF3D00"
                d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
              />
              <path
                fill="#4CAF50"
                d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
              />
              <path
                fill="#1976D2"
                d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
              />
            </svg>
            Entrar com Google
          </a>
        ) : devLoginEnabled() ? (
          <form method="post" action="/api/auth/dev">
            <button className="login-dev" type="submit">
              Entrar como visitante de teste
            </button>
            <p className="login-fine">
              Modo de desenvolvimento: o login com Google aparece quando GOOGLE_CLIENT_ID e
              GOOGLE_CLIENT_SECRET estiverem configurados.
            </p>
          </form>
        ) : (
          <p className="login-error" role="alert">
            {errors.config}
          </p>
        )}
        <p className="login-fine">
          Usamos sua conta apenas para controlar o tempo grátis e o pagamento. Painel independente,
          sem vínculo com o TSE.
        </p>
      </section>
    </main>
  );
}
