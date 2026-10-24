import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { activeSession } from '@/lib/access/auth';
import { NO_PARTY, PARTIES } from '@/lib/profile/parties';
import { PanelPreview } from '../login/panel-preview';
import { ProfileForm } from './profile-form';
import '../login/login.css';
import './cadastro.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Cadastro — Resultados Brasil',
  robots: { index: false },
};
/** Sign-up after the first login. The free time does not run here. */
export default async function SignUpPage() {
  const active = await activeSession();
  if (!active) redirect('/login');
  if (active.user.onboardedAt !== null) redirect('/');
  return (
    <main className="login" id="conteudo">
      <PanelPreview />
      <section className="login-card signup-card" aria-labelledby="signup-title">
        <p className="login-eyebrow">Resultados Brasil · Eleições 2026</p>
        <h1 id="signup-title">Quase lá</h1>
        <p className="login-text">
          Escolha seu nome e toque no lado que você apoia. Em seguida você libera o acesso à
          apuração.
        </p>
        <ProfileForm
          parties={PARTIES}
          noParty={NO_PARTY}
          suggestion={suggestUsername(active.user.name)}
        />
      </section>
    </main>
  );
}

/** A starting point from the account name (the e-mail before the @): "maria.souza" → "mariasouza". */
function suggestUsername(name: string) {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : '';
}
