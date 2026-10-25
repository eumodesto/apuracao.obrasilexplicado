import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isAdmin, isGuest } from '@/lib/access/access';
import { activeSession } from '@/lib/access/auth';
import { devLoginEnabled } from '@/lib/access/config';
import { safeNext } from '@/lib/access/next';
import { PanelPreview } from './panel-preview';
import { PasswordForm } from './password-form';
import './login.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Entrar — Resultados Brasil', robots: { index: false } };
const errors: Record<string, string> = {
  suspensa:
    'Sua conta está suspensa pela moderação. Se acha que é um engano, fale com a equipe do Resultados Brasil.',
  excluida: 'Esta conta foi excluída.',
  'outro-aparelho':
    'Sua conta foi conectada em outro aparelho e este foi desconectado. Para continuar aqui, entre de novo: o outro aparelho é que será desconectado.',
};
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; next?: string }>;
}) {
  const { erro, next: requested } = await searchParams;
  // Where to go after signing in (e.g. /admin); only paths of this site.
  const next = safeNext(requested);
  const adminEntry = next === '/admin';
  const active = await activeSession();
  // Already the administrator: open the area.
  if (active && isAdmin(active.user) && adminEntry) redirect('/admin');
  // Panel opens as a visitor first — /login is only for real accounts (or errors / admin e-mail).
  if (active && isGuest(active.user) && !erro && !adminEntry) redirect('/');
  if (!active && !erro && next === '/') redirect('/');
  // A suspended or deleted account stays here, with the reason, instead of looping back.
  // Admin entry keeps the form so a username session can switch to the e-mail account.
  if (
    active &&
    !isGuest(active.user) &&
    !active.user.pausedAt &&
    !active.user.deletedAt &&
    !adminEntry
  )
    redirect(next);

  if (adminEntry) {
    return (
      <main className="login-admin" id="conteudo">
        <h1>Admin</h1>
        {erro && errors[erro] && (
          <p className="login-error" role="alert">
            {errors[erro]}
          </p>
        )}
        <PasswordForm next={next} variant="email" />
        {active && (
          <form method="post" action="/api/auth/logout?next=/admin">
            <button type="submit">Sair da conta atual</button>
          </form>
        )}
      </main>
    );
  }

  return (
    <main className="login" id="conteudo">
      <PanelPreview />
      <section className="login-card" aria-labelledby="login-title">
        <p className="login-eyebrow">Resultados Brasil · Eleições 2026</p>
        <h1 id="login-title">Acompanhe a apuração ao vivo</h1>
        <p className="login-text">
          Resultados oficiais do TSE para Presidente, com mapa por estado, município e zona
          eleitoral.
        </p>
        {erro && errors[erro] && (
          <p className="login-error" role="alert">
            {errors[erro]}
          </p>
        )}
        <PasswordForm next={next} variant="username" />
        {devLoginEnabled() && (
          <form className="login-dev-form" method="post" action="/api/auth/dev">
            <input type="hidden" name="next" value={next} />
            <label className="login-dev-label" htmlFor="dev-email">
              E-mail da conta de teste
            </label>
            <input
              id="dev-email"
              className="login-dev-email"
              name="email"
              type="email"
              defaultValue="teste@localhost"
              required
            />
            <button className="login-dev" type="submit">
              Entrar como visitante de teste
            </button>
            <p className="login-fine">
              Só em desenvolvimento: entra sem senha. Use o mesmo e-mail da conta com senha (admin
              incluso) — é a mesma conta.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
