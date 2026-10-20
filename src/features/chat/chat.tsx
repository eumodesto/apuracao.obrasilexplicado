'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { BADGE_SLOT_ID, useAccess } from '@/features/access/access-gate';
import { brl } from '@/features/access/format';
import { MAX_MESSAGE_LENGTH } from '@/lib/chat/text';
import type { PublicMessage } from '@/lib/chat/types';
import { partyByCode } from '@/lib/profile/parties';
import './chat.css';

const KEEP = 200;
/** Wide screens keep the chat docked beside the panel; smaller ones open it over it. */
const DOCKED_QUERY = '(min-width: 1600px)';
/** Within this distance from the bottom the list follows new messages. */
const STICKY_PX = 80;

type Report = { id: string; state: 'confirm' | 'sending' | 'done' };

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

const subscribeDocked = (onChange: () => void) => {
  const query = window.matchMedia(DOCKED_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const isDocked = () => window.matchMedia(DOCKED_QUERY).matches;
const noSubscription = () => () => {};
const badgeSlot = () => document.getElementById(BADGE_SLOT_ID);

const merge = (list: PublicMessage[], incoming: PublicMessage[]) => {
  const seen = new Set(list.map((message) => message.id));
  const next = [...list, ...incoming.filter((message) => !seen.has(message.id))];
  next.sort((a, b) => a.createdAt - b.createdAt);
  return next.slice(-KEEP);
};

/** Live chat beside the election panel. Everyone signed in reads; paid accounts write. */
export function ChatDock() {
  const { status, offerAccess } = useAccess();
  // Open by default where it docks beside the panel; afterwards the reader decides.
  const docked = useSyncExternalStore(subscribeDocked, isDocked, () => false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? docked;
  // The launcher lives in the floating badge rendered by AccessGate.
  const slot = useSyncExternalStore(noSubscription, badgeSlot, () => null);
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [online, setOnline] = useState<number | null>(null);
  const [me, setMe] = useState<string | null>(status.user.username);
  // Paid accounts write; the access state updates the moment a payment is confirmed, while the
  // stream's own report can lag behind it.
  const [serverCanWrite, setCanWrite] = useState(false);
  const canWrite = status.state === 'paid' || serverCanWrite;
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [moderator, setModerator] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const openRef = useRef(open);
  const atBottomRef = useRef(atBottom);
  useEffect(() => {
    openRef.current = open;
    atBottomRef.current = atBottom;
  }, [open, atBottom]);

  const scrollToEnd = useCallback((smooth = false) => {
    const element = list.current;
    if (element)
      element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Phones: fit the panel to the visible area, which shrinks when the keyboard opens.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const fit = () => {
      document.documentElement.style.setProperty('--chat-height', `${viewport.height}px`);
      document.documentElement.style.setProperty('--chat-top', `${viewport.offsetTop}px`);
      if (atBottomRef.current) scrollToEnd();
    };
    fit();
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    return () => {
      viewport.removeEventListener('resize', fit);
      viewport.removeEventListener('scroll', fit);
    };
  }, [open, scrollToEnd]);

  useEffect(() => {
    const source = new EventSource('/api/chat/stream');
    const data = (event: Event) => JSON.parse((event as MessageEvent).data);
    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(false));
    source.addEventListener('hello', (event) => {
      const body = data(event);
      setMessages((current) => merge(current, body.messages));
      setOnline(body.online);
      setMe(body.me);
      setCanWrite(body.canWrite);
      setModerator(body.moderator === true);
      setConnected(true);
    });
    source.addEventListener('message', (event) => {
      const { message } = data(event) as { message: PublicMessage };
      setMessages((current) => merge(current, [message]));
      if (!openRef.current || !atBottomRef.current) setUnread((count) => count + 1);
    });
    source.addEventListener('delete', (event) => {
      const { id } = data(event);
      setMessages((current) => current.filter((message) => message.id !== id));
    });
    source.addEventListener('online', (event) => setOnline(data(event).online));
    source.addEventListener('access', (event) => setCanWrite(data(event).canWrite));
    source.addEventListener('end', (event) => {
      source.close();
      setConnected(false);
      const { code } = data(event);
      // A full navigation also stops the panel's other polls.
      const target =
        code === 'replaced'
          ? '/login?erro=outro-aparelho'
          : code === 'onboarding'
            ? '/cadastro'
            : code === 'paused'
              ? '/login?erro=suspensa'
              : code === 'deleted'
                ? '/login?erro=excluida'
                : null;
      if (target) window.location.assign(target);
    });
    return () => source.close();
  }, []);

  // Follow new messages only while the reader is at the bottom.
  useLayoutEffect(() => {
    if (open && atBottomRef.current) scrollToEnd();
  }, [messages, open, scrollToEnd]);

  const onScroll = () => {
    const element = list.current;
    if (!element) return;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_PX;
    setAtBottom(bottom);
    if (bottom) setUnread(0);
  };

  const setOpen = (next: boolean) => {
    setChoice(next);
    if (next && atBottomRef.current) setUnread(0);
  };

  const sendReport = async (id: string) => {
    setReport({ id, state: 'sending' });
    await fetch(`/api/chat/messages/${id}/report`, { method: 'POST' }).catch(() => null);
    setReport({ id, state: 'done' });
    setTimeout(() => setReport((current) => (current?.id === id ? null : current)), 2500);
  };

  // Administrators: the stream's delete event removes it for everyone, this tab included.
  const removeMessage = async (id: string) => {
    const response = await fetch(`/api/admin/messages/${id}`, { method: 'DELETE' }).catch(
      () => null,
    );
    if (response?.ok) setMessages((current) => current.filter((message) => message.id !== id));
    setRemoving(null);
  };

  const launcher = (
    <button
      type="button"
      className={open ? 'chat-launcher is-open' : 'chat-launcher'}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-controls="chat-panel"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 5h16v11H9l-5 4V5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      Chat
      {unread > 0 && !open && (
        <span className="chat-launcher-count" aria-label={`${unread} mensagens novas`}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );

  return (
    <>
      {slot && createPortal(launcher, slot)}
      <aside
        id="chat-panel"
        className={open ? 'chat-panel is-open' : 'chat-panel'}
        aria-label="Chat ao vivo"
        hidden={!open}
      >
        <header className="chat-header">
          <div>
            <h2>Chat ao vivo</h2>
            <p className={connected ? 'chat-online' : 'chat-online is-offline'}>
              {connected
                ? online !== null
                  ? `${online.toLocaleString('pt-BR')} ${online === 1 ? 'pessoa' : 'pessoas'} no chat`
                  : 'Conectando…'
                : 'Reconectando…'}
            </p>
          </div>
          <button
            type="button"
            className="chat-close"
            onClick={() => setOpen(false)}
            aria-label="Fechar o chat"
          >
            ×
          </button>
        </header>

        <ol className="chat-list" ref={list} onScroll={onScroll} role="log" aria-live="off">
          {messages.length === 0 && (
            <li className="chat-empty">
              {connected ? 'Ninguém falou ainda. Comece a conversa!' : 'Carregando mensagens…'}
            </li>
          )}
          {messages.map((message) => {
            const party = partyByCode(message.party);
            const mine = message.username === me;
            return (
              <li key={message.id} className={mine ? 'chat-message is-mine' : 'chat-message'}>
                <div className="chat-meta">
                  <span
                    className="chat-author"
                    style={{ '--party': party?.color ?? '#87877e' } as React.CSSProperties}
                  >
                    <span
                      className="chat-party"
                      aria-label={party ? `Apoia o ${party.number}` : undefined}
                    >
                      {party?.number ?? ''}
                    </span>
                    @{message.username}
                  </span>
                  <time dateTime={new Date(message.createdAt).toISOString()}>
                    {timeOf(message.createdAt)}
                  </time>
                  {moderator &&
                    (removing === message.id ? (
                      <span className="chat-report-confirm">
                        Apagar para todos?
                        <button type="button" onClick={() => removeMessage(message.id)}>
                          Sim
                        </button>
                        <button type="button" onClick={() => setRemoving(null)}>
                          Não
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="chat-report chat-remove"
                        onClick={() => setRemoving(message.id)}
                        aria-label={`Apagar mensagem de @${message.username}`}
                        title="Apagar (administração)"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    ))}
                  {!mine &&
                    removing !== message.id &&
                    (report?.id === message.id ? (
                      report.state === 'confirm' ? (
                        <span className="chat-report-confirm">
                          Denunciar?
                          <button type="button" onClick={() => sendReport(message.id)}>
                            Sim
                          </button>
                          <button type="button" onClick={() => setReport(null)}>
                            Não
                          </button>
                        </span>
                      ) : (
                        <span className="chat-report-done">
                          {report.state === 'done' ? 'Denúncia enviada' : 'Enviando…'}
                        </span>
                      )
                    ) : (
                      <button
                        type="button"
                        className="chat-report"
                        onClick={() => setReport({ id: message.id, state: 'confirm' })}
                        aria-label={`Denunciar mensagem de @${message.username}`}
                        title="Denunciar"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M5 21V4m0 0h11l-2 4 2 4H5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    ))}
                </div>
                <p className="chat-text">{message.text}</p>
              </li>
            );
          })}
        </ol>

        {!atBottom && (
          <button
            type="button"
            className="chat-jump"
            onClick={() => {
              scrollToEnd(true);
              setUnread(0);
            }}
          >
            {unread > 0 ? `${unread} novas mensagens ↓` : 'Ir para o fim ↓'}
          </button>
        )}

        {canWrite ? (
          <Composer onSent={(message) => setMessages((current) => merge(current, [message]))} />
        ) : (
          <div className="chat-locked">
            <p>Você está no tempo grátis: dá para ler o chat, mas não escrever.</p>
            <button type="button" onClick={offerAccess}>
              Liberar para escrever · {brl(status.price)}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

function Composer({ onSent }: { onSent: (message: PublicMessage) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const field = useRef<HTMLTextAreaElement>(null);
  const waiting = Math.max(0, Math.ceil((waitUntil - now) / 1000));

  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= waitUntil) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [waitUntil]);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || sending || waiting > 0) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 429) {
        setWaitUntil(Date.now() + (body.retryAfterMs ?? 5000));
        setNow(Date.now());
      }
      if (!response.ok) return setError(body.error ?? 'Não foi possível enviar.');
      onSent(body.message);
      setText('');
      // Slow mode starts with every message.
      setWaitUntil(Date.now() + 5000);
      setNow(Date.now());
    } catch {
      setError('Falha de conexão. Tente de novo.');
    } finally {
      setSending(false);
      field.current?.focus();
    }
  };

  const left = MAX_MESSAGE_LENGTH - text.length;
  return (
    <form className="chat-composer" onSubmit={submit}>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-input">
        <label className="sr-only" htmlFor="chat-text">
          Mensagem
        </label>
        <textarea
          ref={field}
          id="chat-text"
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Escreva no chat…"
          enterKeyHint="send"
          onChange={(event) => {
            setText(event.target.value.replace(/\n/g, ' '));
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" disabled={!text.trim() || sending || waiting > 0}>
          {waiting > 0 ? `${waiting}s` : 'Enviar'}
        </button>
      </div>
      <p className={left <= 20 ? 'chat-counter is-low' : 'chat-counter'}>
        {waiting > 0 ? 'Modo lento: uma mensagem a cada 5 segundos.' : `${left} caracteres`}
      </p>
    </form>
  );
}
