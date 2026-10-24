import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { activeSession } from '@/lib/access/auth';
import { adminEmails, isDevelopment } from '@/lib/access/config';
import { adminSession } from '@/lib/admin/guard';
import { AdminApp } from './admin-app';
import './admin.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Administração — Resultados Brasil',
  robots: { index: false },
};

/** Internal area: accounts, chat moderation and the audit log. Invisible to everyone else. */
export default async function AdminPage() {
  const admin = await adminSession();
  if (admin) return <AdminApp me={admin.user.email} />;
  const active = await activeSession();
  if (!active) redirect('/login?next=/admin');
  // In production the area does not reveal itself; locally, say what is missing.
  if (!isDevelopment()) notFound();
  return <AdminHelp email={active.user.email} configured={[...adminEmails()]} />;
}

function AdminHelp({ email, configured }: { email: string; configured: string[] }) {
  return (
    <main className="admin-help" id="conteudo">
      <h1>Esta conta não é de administrador</h1>
      <p>
        Você entrou como <b>{email}</b>.
      </p>
      {configured.length === 0 ? (
        <p>
          Nenhum administrador configurado: <code>ADMIN_EMAILS</code> está vazio.
        </p>
      ) : (
        <p>
          Administradores configurados: <b>{configured.join(', ')}</b>.
        </p>
      )}
      <ol>
        <li>
          No arquivo <code>.env.local</code>, na raiz do projeto, coloque:
          <pre>ADMIN_EMAILS={email}</pre>
        </li>
        <li>
          Pare e inicie de novo o <code>npm run dev</code> (o arquivo só é lido ao iniciar).
        </li>
        <li>
          Saia e entre de novo com um desses e-mails:
          <form method="post" action="/api/auth/logout?next=/admin">
            <button type="submit">Sair e entrar com outra conta</button>
          </form>
        </li>
      </ol>
      <p className="admin-help-note">Esta explicação só aparece no modo de desenvolvimento.</p>
    </main>
  );
}
