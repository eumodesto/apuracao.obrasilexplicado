'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { brl } from '@/features/access/format';
import { Avatar } from '@/features/chat/avatar';
import type { AuditEntry } from '@/lib/admin/audit';
import type { AdminUser } from '@/lib/admin/view';
import { partyByCode } from '@/lib/profile/parties';

type Tab = 'overview' | 'users' | 'moderation' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'users', label: 'Usuários' },
  { id: 'moderation', label: 'Moderação' },
  { id: 'audit', label: 'Registro' },
];

type Overview = {
  users: number;
  onboarded: number;
  paid: number;
  paused: number;
  deleted: number;
  switchedDevices: number;
  revenue: number;
  approvedPayments: number;
  online: number;
  notifySignups: number;
  reportedMessages: number;
};
type Message = {
  id: string;
  userId: string;
  username: string;
  party: string | null;
  photo: string | null;
  text: string;
  sticker: string | null;
  createdAt: number;
  reports?: number;
};

const number = (value: number) => value.toLocaleString('pt-BR');
const when = (at: number | null) =>
  at === null
    ? '—'
    : new Date(at).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });

/** Loads `url` again whenever `version` changes; null while the first answer is on its way. */
function useJson<T>(url: string, version: number) {
  const [state, setState] = useState<{ url: string; data: T | null; error: boolean }>({
    url,
    data: null,
    error: false,
  });
  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A request that never answers must not leave "Carregando…" forever: give up after 15 s and
    // try again a few times before showing the error.
    const load = (attempt: number) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      fetch(url, { cache: 'no-store', signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
        .then((data: T) => live && setState({ url, data, error: false }))
        .catch(() => {
          if (!live) return;
          if (attempt < 3) retry = setTimeout(() => load(attempt + 1), 1_500 * (attempt + 1));
          else setState((current) => ({ ...current, url, error: true }));
        })
        .finally(() => clearTimeout(timeout));
    };
    load(0);
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [url, version]);
  // A new address (another page or search) never shows the previous one's rows.
  return state.url === url ? state : { url, data: null, error: false };
}

/** Refreshes on its own every `ms` while the tab is visible. */
function useTick(ms: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((value) => value + 1);
    }, ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}

async function send(url: string, init: RequestInit) {
  const response = await fetch(url, init).catch(() => null);
  if (!response) return { ok: false, error: 'Falha de conexão. Tente de novo.' };
  const body = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, error: null } : { ok: false, error: body.error ?? 'Erro.' };
}

export function AdminApp({ me }: { me: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  // Opens an account straight from a chat message.
  const showUser = (query: string) => {
    setSearch(query);
    setTab('users');
  };
  return (
    <div className="admin">
      <header className="admin-header">
        <div className="admin-brand">
          <span className="admin-mark" aria-hidden="true">
            RB
          </span>
          <div>
            <h1>Administração</h1>
            <p>Resultados Brasil · {me}</p>
          </div>
        </div>
        <Link href="/" className="admin-back">
          Voltar ao painel
        </Link>
      </header>
      <nav className="admin-tabs" aria-label="Seções">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'is-current' : undefined}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="admin-main" id="conteudo">
        {tab === 'overview' && <OverviewTab onModerate={() => setTab('moderation')} />}
        {tab === 'users' && <UsersTab key={search} initialQuery={search} />}
        {tab === 'moderation' && <ModerationTab onUser={showUser} />}
        {tab === 'audit' && <AuditTab />}
      </main>
    </div>
  );
}

function OverviewTab({ onModerate }: { onModerate: () => void }) {
  const tick = useTick(15_000);
  const { data, error } = useJson<Overview>('/api/admin/overview', tick);
  if (!data) return <Loading error={error} />;
  const cards: { label: string; value: string; note?: string; tone?: string }[] = [
    { label: 'Online no chat', value: number(data.online), note: 'agora', tone: 'live' },
    { label: 'Contas', value: number(data.users), note: `${number(data.onboarded)} com cadastro` },
    { label: 'Pagantes', value: number(data.paid), note: `${number(data.approvedPayments)} Pix` },
    { label: 'Receita', value: brl(data.revenue), tone: 'money' },
    { label: 'Suspensas', value: number(data.paused) },
    { label: 'Excluídas', value: number(data.deleted) },
    {
      label: 'Trocaram de aparelho',
      value: number(data.switchedDevices),
      note: 'possível conta dividida',
    },
    { label: 'Avisos do 2º turno', value: number(data.notifySignups), note: 'e-mails' },
  ];
  return (
    <section aria-labelledby="overview-title">
      <h2 id="overview-title" className="admin-title">
        Visão geral
      </h2>
      {data.reportedMessages > 0 && (
        <button type="button" className="admin-alert" onClick={onModerate}>
          <b>{number(data.reportedMessages)}</b>{' '}
          {data.reportedMessages === 1 ? 'mensagem denunciada' : 'mensagens denunciadas'} esperando
          revisão →
        </button>
      )}
      <div className="admin-cards">
        {cards.map((card) => (
          <div key={card.label} className={card.tone ? `admin-card is-${card.tone}` : 'admin-card'}>
            <span>{card.label}</span>
            <b>{card.value}</b>
            {card.note && <small>{card.note}</small>}
          </div>
        ))}
      </div>
      <div className="admin-panel">
        <div>
          <h3>Lista &quot;Me avise&quot;</h3>
          <p>E-mails de quem pediu aviso quando a apuração do 2º turno começar.</p>
        </div>
        <a className="admin-button" href="/api/admin/notify" download>
          Baixar CSV
        </a>
      </div>
      <p className="admin-hint">Atualiza sozinho a cada 15 segundos.</p>
    </section>
  );
}

type UsersPage = { users: AdminUser[]; total: number; page: number; pageSize: number };

/** Creates an account with username, e-mail and password; access already unlocked (no charge). */
function NewUserForm({ onCreated }: { onCreated: (username: string) => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  if (!open)
    return (
      <div className="admin-new">
        <button type="button" className="admin-button" onClick={() => setOpen(true)}>
          + Novo usuário
        </button>
        <p className="admin-hint">Acesso liberado na hora · sem cobrança no Mercado Pago</p>
        {message && !message.error && <p className="admin-hint">{message.text}</p>}
      </div>
    );
  return (
    <form
      className="admin-new admin-inline"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        const login = username.replace(/^@+/, '').trim();
        const result = await send('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: login, email: email.trim(), password }),
        });
        setBusy(false);
        if (!result.ok) return setMessage({ error: true, text: result.error ?? 'Erro.' });
        setMessage({
          error: false,
          text: `Conta @${login} criada com acesso liberado (sem Mercado Pago).`,
        });
        onCreated(login);
        setUsername('');
        setEmail('');
        setPassword('');
        setOpen(false);
      }}
    >
      <label className="sr-only" htmlFor="new-username">
        Nome de usuário
      </label>
      <input
        id="new-username"
        type="text"
        value={username}
        onChange={(event) => setUsername(event.target.value.replace(/^@+/, '').replace(/\s+/g, ''))}
        placeholder="@usuário"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={20}
        required
        autoFocus
      />
      <label className="sr-only" htmlFor="new-email">
        E-mail (usado no Mercado Pago)
      </label>
      <input
        id="new-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value.replace(/\s+/g, ''))}
        placeholder="E-mail do usuário"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        required
      />
      <label className="sr-only" htmlFor="new-password">
        Senha
      </label>
      <input
        id="new-password"
        type="text"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Senha (mínimo 8)"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <button type="submit" className="admin-button" disabled={busy}>
        Criar conta
      </button>
      <button type="button" className="admin-button is-ghost" onClick={() => setOpen(false)}>
        Cancelar
      </button>
      {message?.error && (
        <p className="admin-error" role="alert">
          {message.text}
        </p>
      )}
    </form>
  );
}

function UsersTab({ initialQuery }: { initialQuery: string }) {
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const url = `/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`;
  const { data, error } = useJson<UsersPage>(url, version);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section aria-labelledby="users-title">
      <h2 id="users-title" className="admin-title">
        Usuários
      </h2>
      <NewUserForm
        onCreated={(username) => {
          setDraft(username);
          setQuery(username);
          setPage(1);
          setVersion((v) => v + 1);
        }}
      />
      <form
        className="admin-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
          setPage(1);
        }}
      >
        <label className="sr-only" htmlFor="admin-q">
          Buscar
        </label>
        <input
          id="admin-q"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Usuário, e-mail, nome ou id"
          autoComplete="off"
        />
        <button type="submit" className="admin-button">
          Buscar
        </button>
      </form>
      {!data ? (
        <Loading error={error} />
      ) : data.users.length === 0 ? (
        <p className="admin-empty">Nenhuma conta encontrada.</p>
      ) : (
        <>
          <p className="admin-hint">
            {number(data.total)} {data.total === 1 ? 'conta' : 'contas'}
            {query && <> para &quot;{query}&quot;</>}
          </p>
          <ul className="admin-users">
            {data.users.map((user) => (
              <UserRow key={user.id} user={user} onChange={() => setVersion((v) => v + 1)} />
            ))}
          </ul>
          {pages > 1 && (
            <nav className="admin-pages" aria-label="Páginas">
              <button
                type="button"
                className="admin-button is-ghost"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ← Anterior
              </button>
              <span>
                {page} de {pages}
              </span>
              <button
                type="button"
                className="admin-button is-ghost"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Próxima →
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function StatusChip({ user }: { user: AdminUser }) {
  if (user.deletedAt) return <span className="admin-chip is-deleted">Excluída</span>;
  if (user.pausedAt) return <span className="admin-chip is-paused">Suspensa</span>;
  if (user.admin) return <span className="admin-chip is-admin">Admin</span>;
  if (user.staff) return <span className="admin-chip is-admin">Equipe</span>;
  if (user.granted) return <span className="admin-chip is-admin">Liberado</span>;
  if (user.paid) return <span className="admin-chip is-paid">Pago (MP)</span>;
  if (!user.onboardedAt) return <span className="admin-chip">Sem cadastro</span>;
  return <span className="admin-chip">Grátis</span>;
}

function UserRow({ user, onChange }: { user: AdminUser; onChange: () => void }) {
  const [mode, setMode] = useState<'idle' | 'pause' | 'delete' | 'password'>('idle');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const party = partyByCode(user.party);
  const act = async (body: object) => {
    setBusy(true);
    setError(null);
    const result = await send(`/api/admin/users/${user.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setMode('idle');
    setReason('');
    setPassword('');
    onChange();
  };
  return (
    <li className={user.deletedAt ? 'admin-user is-gone' : 'admin-user'}>
      <div className="admin-user-main">
        <div className="admin-user-name">
          <Avatar
            photo={user.photo}
            name={user.username ?? user.name}
            label={party?.number}
            color={party?.color ?? '#87877e'}
            size={40}
          />
          {party && (
            <span className="admin-party" style={{ background: party.color }}>
              {party.number}
            </span>
          )}
          <b>{user.username ? `@${user.username}` : '(sem usuário)'}</b>
          <StatusChip user={user} />
        </div>
        <p className="admin-user-mail">{[user.name, user.email].filter(Boolean).join(' · ')}</p>
        <dl className="admin-user-facts">
          <div>
            <dt>Entrou</dt>
            <dd>{when(user.createdAt)}</dd>
          </div>
          <div>
            <dt>Visto</dt>
            <dd>{when(user.lastSeenAt)}</dd>
          </div>
          <div>
            <dt>Acesso</dt>
            <dd>
              {user.paidAt
                ? `${user.granted ? 'Liberado (admin)' : 'Pago (Mercado Pago)'} · ${when(user.paidAt)}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Tempo grátis</dt>
            <dd>{user.freeSecondsUsed}s</dd>
          </div>
          <div>
            <dt>Trocas de aparelho</dt>
            <dd className={user.sessionChanges >= 3 ? 'is-warn' : undefined}>
              {user.sessionChanges}
            </dd>
          </div>
        </dl>
        {user.pausedAt && user.pausedReason && (
          <p className="admin-user-reason">Motivo da suspensão: {user.pausedReason}</p>
        )}
      </div>
      {!user.deletedAt && (
        <div className="admin-user-actions">
          {mode === 'pause' && !user.admin ? (
            <form
              className="admin-inline"
              onSubmit={(event) => {
                event.preventDefault();
                act({ action: 'pause', reason });
              }}
            >
              <label className="sr-only" htmlFor={`reason-${user.id}`}>
                Motivo
              </label>
              <input
                id={`reason-${user.id}`}
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Motivo (a pessoa não vê)"
                autoFocus
              />
              <button type="submit" className="admin-button is-warn" disabled={busy || !reason}>
                Suspender
              </button>
              <button
                type="button"
                className="admin-button is-ghost"
                onClick={() => setMode('idle')}
              >
                Cancelar
              </button>
            </form>
          ) : mode === 'password' ? (
            <form
              className="admin-inline"
              onSubmit={(event) => {
                event.preventDefault();
                act({ action: 'set_password', password });
              }}
            >
              <label className="sr-only" htmlFor={`password-${user.id}`}>
                Nova senha
              </label>
              <input
                id={`password-${user.id}`}
                type="text"
                value={password}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Nova senha (mínimo 8)"
                autoComplete="new-password"
                autoFocus
              />
              <button type="submit" className="admin-button" disabled={busy || password.length < 8}>
                Salvar senha
              </button>
              <button
                type="button"
                className="admin-button is-ghost"
                onClick={() => setMode('idle')}
              >
                Cancelar
              </button>
            </form>
          ) : mode === 'delete' && !user.admin ? (
            <div className="admin-inline">
              <span>Excluir a conta e apagar as mensagens dela? Não dá para desfazer.</span>
              <button
                type="button"
                className="admin-button is-danger"
                disabled={busy}
                onClick={() => act({ action: 'delete' })}
              >
                Excluir
              </button>
              <button
                type="button"
                className="admin-button is-ghost"
                onClick={() => setMode('idle')}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <>
              {!user.admin &&
                (user.pausedAt ? (
                  <button
                    type="button"
                    className="admin-button"
                    disabled={busy}
                    onClick={() => act({ action: 'unpause' })}
                  >
                    Reativar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="admin-button is-warn"
                    onClick={() => setMode('pause')}
                  >
                    Suspender
                  </button>
                ))}
              <button
                type="button"
                className="admin-button is-ghost"
                onClick={() => setMode('password')}
              >
                Trocar senha
              </button>
              {!user.admin && !user.paid && !user.staff && (
                <button
                  type="button"
                  className="admin-button"
                  disabled={busy}
                  onClick={() => act({ action: 'grant_access' })}
                >
                  Liberar acesso
                </button>
              )}
              {!user.admin && user.photo && (
                <button
                  type="button"
                  className="admin-button is-ghost"
                  disabled={busy}
                  onClick={() => act({ action: 'remove_photo' })}
                >
                  Remover foto
                </button>
              )}
              {!user.admin && (
                <button
                  type="button"
                  className="admin-button is-danger is-ghost"
                  onClick={() => setMode('delete')}
                >
                  Excluir
                </button>
              )}
            </>
          )}
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function ModerationTab({ onUser }: { onUser: (query: string) => void }) {
  const tick = useTick(10_000);
  const [version, setVersion] = useState(0);
  const reports = useJson<{ reports: Message[] }>('/api/admin/reports', tick + version);
  const recent = useJson<{ messages: Message[] }>('/api/admin/messages', tick + version);
  const refresh = () => setVersion((v) => v + 1);
  return (
    <section aria-labelledby="moderation-title">
      <h2 id="moderation-title" className="admin-title">
        Moderação do chat
      </h2>
      <div className="admin-columns">
        <div>
          <h3 className="admin-subtitle">Denunciadas</h3>
          {!reports.data ? (
            <Loading error={reports.error} />
          ) : reports.data.reports.length === 0 ? (
            <p className="admin-empty">Nenhuma denúncia pendente.</p>
          ) : (
            <MessageList messages={reports.data.reports} onDone={refresh} onUser={onUser} />
          )}
        </div>
        <div>
          <h3 className="admin-subtitle">Mais recentes</h3>
          {!recent.data ? (
            <Loading error={recent.error} />
          ) : recent.data.messages.length === 0 ? (
            <p className="admin-empty">Nenhuma mensagem ainda.</p>
          ) : (
            <MessageList messages={recent.data.messages} onDone={refresh} onUser={onUser} />
          )}
        </div>
      </div>
    </section>
  );
}

function MessageList({
  messages,
  onDone,
  onUser,
}: {
  messages: Message[];
  onDone: () => void;
  onUser: (query: string) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = async (id: string) => {
    const result = await send(`/api/admin/messages/${id}`, { method: 'DELETE' });
    setConfirm(null);
    setError(result.error);
    onDone();
  };
  return (
    <>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <ul className="admin-messages">
        {messages.map((message) => {
          const party = partyByCode(message.party);
          return (
            <li key={message.id} className="admin-message">
              <div>
                <div className="admin-message-meta">
                  <Avatar
                    photo={message.photo}
                    name={message.username}
                    label={party?.number}
                    color={party?.color ?? '#87877e'}
                    size={28}
                  />
                  {party && (
                    <span className="admin-party" style={{ background: party.color }}>
                      {party.number}
                    </span>
                  )}
                  <button
                    type="button"
                    className="admin-link"
                    onClick={() => onUser(message.userId)}
                    title="Ver a conta"
                  >
                    @{message.username}
                  </button>
                  <time>{when(message.createdAt)}</time>
                  {message.reports !== undefined && (
                    <span className="admin-chip is-paused">
                      {message.reports} {message.reports === 1 ? 'denúncia' : 'denúncias'}
                    </span>
                  )}
                </div>
                <p className="admin-message-text">
                  {message.sticker && <span className="admin-chip">Figurinha</span>} {message.text}
                </p>
              </div>
              <div className="admin-message-actions">
                {confirm === message.id ? (
                  <>
                    <span>Apagar para todos?</span>
                    <button
                      type="button"
                      className="admin-button is-danger"
                      onClick={() => remove(message.id)}
                    >
                      Apagar
                    </button>
                    <button
                      type="button"
                      className="admin-button is-ghost"
                      onClick={() => setConfirm(null)}
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="admin-button is-danger is-ghost"
                    onClick={() => setConfirm(message.id)}
                  >
                    Apagar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const ACTIONS: Record<AuditEntry['action'], string> = {
  pause: 'suspendeu',
  unpause: 'reativou',
  delete_user: 'excluiu a conta',
  delete_message: 'apagou mensagem de',
  remove_photo: 'removeu a foto de',
  create_user: 'criou a conta',
  set_password: 'trocou a senha de',
  grant_access: 'liberou o acesso de',
};

function AuditTab() {
  const { data, error } = useJson<{ entries: AuditEntry[] }>('/api/admin/audit', 0);
  return (
    <section aria-labelledby="audit-title">
      <h2 id="audit-title" className="admin-title">
        Registro de ações
      </h2>
      {!data ? (
        <Loading error={error} />
      ) : data.entries.length === 0 ? (
        <p className="admin-empty">Nenhuma ação registrada.</p>
      ) : (
        <ol className="admin-audit">
          {data.entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time>{when(entry.at)}</time>
              <p>
                <b>{entry.admin}</b> {ACTIONS[entry.action]} <b>{entry.target}</b>
                {entry.detail && <span className="admin-audit-detail">{entry.detail}</span>}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Loading({ error }: { error: boolean }) {
  return error ? (
    <p className="admin-error" role="alert">
      Não foi possível carregar. Atualize a página.
    </p>
  ) : (
    <p className="admin-empty">Carregando…</p>
  );
}
