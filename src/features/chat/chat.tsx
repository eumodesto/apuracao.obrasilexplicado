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
import {
  canUseSticker,
  STICKERS,
  stickerById,
  stickersFor,
  type Sticker,
} from '@/lib/chat/stickers';
import { MAX_MESSAGE_LENGTH } from '@/lib/chat/text';
import type { PublicMessage } from '@/lib/chat/types';
import { partyByCode, type Party } from '@/lib/profile/parties';
import { Avatar } from './avatar';
import { LiveSummary } from '@/features/election/live-summary';
import { PhotoCapture } from './photo-capture';
import './chat.css';

const KEEP = 200;
const NO_PARTY_COLOR = '#87877e';
/** A moment `ms` from now (event handlers only). */
const fromNow = (ms = 0) => Date.now() + ms;
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
  const { status, offerAccess, buyStickers, setStickers } = useAccess();
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
  // The free minute (visitors included) writes too; only a locked page cannot.
  const canWrite = status.state !== 'locked' || serverCanWrite;
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  // Phones: the chat fills the screen ("Tela cheia") or leaves the live summary on top.
  const [full, setFull] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [moderator, setModerator] = useState(false);
  const [myPhoto, setMyPhoto] = useState<string | null>(null);
  const [myParty, setMyParty] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
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
      setMyPhoto(body.photo ?? null);
      setMyParty(body.party ?? null);
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

  // A new photo also shows on the messages already on screen.
  const changePhoto = (photo: string | null) => {
    setMyPhoto(photo);
    setMessages((current) =>
      current.map((message) => (message.username === me ? { ...message, photo } : message)),
    );
  };
  const myColor = partyByCode(myParty)?.color ?? NO_PARTY_COLOR;
  const myNumber = partyByCode(myParty)?.number;

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
        className={['chat-panel', open && 'is-open', full && 'is-full'].filter(Boolean).join(' ')}
        aria-label="Chat ao vivo"
        hidden={!open}
      >
        <header className="chat-header">
          <div className="chat-title">
            <h2>Chat ao vivo</h2>
            <p className={connected ? 'chat-online' : 'chat-online is-offline'}>
              {connected
                ? online !== null
                  ? `${online.toLocaleString('pt-BR')} ${online === 1 ? 'pessoa' : 'pessoas'} no chat`
                  : 'Conectando…'
                : 'Reconectando…'}
            </p>
          </div>
          {/* Phones: summary on top by default; "Tela cheia" hides it, "Resumo" brings it back. */}
          <button
            type="button"
            className="chat-mode"
            onClick={() => setFull(!full)}
            aria-pressed={full}
          >
            {full ? 'Resumo' : 'Tela cheia'}
          </button>
          <button
            type="button"
            className="chat-close"
            onClick={() => setOpen(false)}
            aria-label="Fechar o chat"
          >
            ×
          </button>
        </header>
        {!full && <LiveSummary />}

        <ol className="chat-list" ref={list} onScroll={onScroll} role="log" aria-live="off">
          {messages.length === 0 && (
            <li className="chat-empty">
              {connected ? 'Ninguém falou ainda. Comece a conversa!' : 'Carregando mensagens…'}
            </li>
          )}
          {messages.map((message) => {
            const party = partyByCode(message.party);
            const mine = message.username === me;
            const sticker = stickerById(message.sticker);
            return (
              <li key={message.id} className={mine ? 'chat-message is-mine' : 'chat-message'}>
                <Avatar
                  photo={message.photo}
                  name={message.username}
                  label={party?.number}
                  color={party?.color ?? NO_PARTY_COLOR}
                  size={36}
                  className="chat-avatar"
                />
                <div className="chat-body">
                  <div className="chat-meta">
                    <span
                      className="chat-author"
                      style={{ '--party': party?.color ?? NO_PARTY_COLOR } as React.CSSProperties}
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
                  {sticker ? (
                    <StickerCard sticker={sticker} />
                  ) : (
                    <p className="chat-text">{message.text}</p>
                  )}
                </div>
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
          <Composer
            me={me ?? '?'}
            photo={myPhoto}
            party={partyByCode(myParty)}
            onPhoto={() => setCapturing(true)}
            onSent={(message) => setMessages((current) => merge(current, [message]))}
            paid={status.state === 'paid'}
            staff={status.staff}
            stickers={status.stickers}
            onStickers={setStickers}
            onBuy={buyStickers}
            onNeedAccess={offerAccess}
          />
        ) : (
          <div className="chat-locked">
            <p>Seu tempo grátis acabou.</p>
            <button type="button" onClick={offerAccess}>
              Liberar o acesso · {brl(status.price)}
            </button>
          </div>
        )}
      </aside>
      {capturing && (
        <PhotoCapture
          photo={myPhoto}
          name={me ?? '?'}
          color={myColor}
          label={myNumber}
          onClose={() => setCapturing(false)}
          onChange={changePhoto}
        />
      )}
    </>
  );
}

function StickerCard({ sticker }: { sticker: Sticker }) {
  if (sticker.image)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="chat-sticker-image"
        src={sticker.image}
        alt={`Figurinha: ${sticker.text}`}
        width={112}
        height={112}
        loading="lazy"
        draggable={false}
      />
    );
  return (
    <span
      className="chat-sticker"
      style={{ '--from': sticker.from, '--to': sticker.to } as React.CSSProperties}
      role="img"
      aria-label={`Figurinha: ${sticker.text}`}
    >
      <span className="chat-sticker-emoji" aria-hidden="true">
        {sticker.emoji}
      </span>
      <span className="chat-sticker-text" aria-hidden="true">
        {sticker.text}
      </span>
    </span>
  );
}

function Composer({
  me,
  photo,
  party,
  onSent,
  onPhoto,
  paid,
  staff,
  stickers,
  onStickers,
  onBuy,
  onNeedAccess,
}: {
  me: string;
  photo: string | null;
  party: Party | null;
  onSent: (message: PublicMessage) => void;
  /** Opens the camera / upload to change the profile photo. */
  onPhoto: () => void;
  /** Paid access: may use stickers. */
  paid: boolean;
  /** Team: stickers without spending. */
  staff: boolean;
  /** Stickers left in the packs. */
  stickers: number;
  onStickers: (stickers: number) => void;
  /** Opens the sticker shop. */
  onBuy: () => void;
  /** Opens the access offer (stickers need paid access). */
  onNeedAccess: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [tray, setTray] = useState(false);
  const [writing, setWriting] = useState(false);
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

  const openField = () => {
    setWriting(true);
    setTray(false);
    // The field can take focus once its panel is no longer inert.
    requestAnimationFrame(() => field.current?.focus());
  };

  const post = async (content: { text: string } | { sticker: string }) => {
    if (sending || waiting > 0) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 429) {
        setWaitUntil(fromNow(body.retryAfterMs ?? 5000));
        setNow(fromNow());
      }
      if (response.status === 402 && body.code === 'no_stickers') {
        onStickers(0);
        setTray(false);
        onBuy();
      } else if (response.status === 402 && body.code === 'payment_required') {
        setTray(false);
        onNeedAccess();
      }
      if (!response.ok) return setError(body.error ?? 'Não foi possível enviar.');
      onSent(body.message);
      if (typeof body.stickers === 'number') onStickers(body.stickers);
      if ('text' in content) setText('');
      setTray(false);
      // Slow mode starts with every message.
      setWaitUntil(fromNow(5000));
      setNow(fromNow());
    } catch {
      setError('Falha de conexão. Tente de novo.');
    } finally {
      setSending(false);
      if (writing) field.current?.focus();
    }
  };

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!writing) return openField();
    const value = text.trim();
    if (value) post({ text: value });
    else field.current?.focus();
  };

  const left = MAX_MESSAGE_LENGTH - text.length;
  // Today only the 13 has a pack: other parties (or none) see a short note instead.
  const hasPack = stickersFor(party?.code).length > 0;
  const status = sending
    ? 'Enviando…'
    : waiting > 0
      ? `Modo lento · escreva de novo em ${waiting}s`
      : party
        ? `Apoia o ${party.number} · ${party.code}`
        : 'No chat ao vivo';
  return (
    <form className="chat-composer" onSubmit={submit}>
      {tray && (
        <div id="chat-stickers" className="chat-stickers" role="group" aria-label="Figurinhas">
          <div className="chat-stickers-head">
            <p>
              {!hasPack
                ? 'Ainda não há figurinhas para o seu partido'
                : !paid
                  ? 'Figurinhas são para quem liberou o acesso'
                  : staff
                    ? 'Figurinhas da equipe · à vontade'
                    : stickers > 0
                      ? `Você tem ${stickers} ${stickers === 1 ? 'figurinha' : 'figurinhas'}`
                      : 'Escolha uma figurinha para liberar o pacote'}
              {hasPack && paid && (staff || stickers > 0) && <small> · toque para enviar</small>}
            </p>
          </div>
          {[
            { title: null, list: STICKERS.filter((sticker) => !sticker.party) },
            {
              // Party packs: only people who chose that party at sign-up see them.
              title: party ? `Exclusivas do ${party.number}` : null,
              list: STICKERS.filter(
                (sticker) => sticker.party && canUseSticker(sticker, party?.code),
              ),
            },
          ]
            .filter((group) => group.list.length > 0)
            .map((group) => (
              <div key={group.title ?? 'all'}>
                {group.title && <p className="chat-stickers-group">{group.title}</p>}
                <div className="chat-stickers-grid">
                  {group.list.map((sticker) => (
                    <button
                      key={sticker.id}
                      type="button"
                      disabled={sending || waiting > 0}
                      // No access yet: the access offer; no stickers left: the sticker shop.
                      onClick={() =>
                        !paid
                          ? onNeedAccess()
                          : !staff && stickers <= 0
                            ? onBuy()
                            : post({ sticker: sticker.id })
                      }
                      aria-label={`Enviar figurinha: ${sticker.text}`}
                    >
                      <StickerCard sticker={sticker} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <div className={writing ? 'chat-dock is-writing' : 'chat-dock'}>
        {/* Opens upward: the field sits above the dock row. */}
        <div className="chat-dock-field" inert={!writing}>
          <div>
            <label className="sr-only" htmlFor="chat-text">
              Mensagem
            </label>
            <textarea
              ref={field}
              id="chat-text"
              rows={3}
              value={text}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder="Escreva no chat…"
              enterKeyHint="send"
              onChange={(event) => {
                setText(event.target.value.replace(/\n/g, ' '));
                setError(null);
              }}
              // Messages are typed, not pasted: no copy-and-paste campaigns in the chat.
              onPaste={(event) => {
                event.preventDefault();
                setError('No chat, digite a mensagem: colar texto não é permitido.');
              }}
              onDrop={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setWriting(false);
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <button
              type="button"
              className="chat-dock-close"
              onClick={() => setWriting(false)}
              aria-label="Fechar o campo de mensagem"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
            <p className={left <= 20 ? 'chat-counter is-low' : 'chat-counter'}>{left} caracteres</p>
          </div>
        </div>
        <div className="chat-dock-row">
          <button
            type="button"
            className="chat-me"
            onClick={onPhoto}
            aria-label={photo ? 'Trocar sua foto de perfil' : 'Colocar sua foto de perfil'}
            title="Tirar foto ou enviar uma imagem"
          >
            {/* Without a photo, the party number on the party color. */}
            <Avatar
              photo={photo}
              name={me}
              label={party?.number}
              color={party?.color ?? NO_PARTY_COLOR}
              size={38}
            />
            <span className="chat-me-plus" aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 24 24">
                <path
                  d="M3 8h4l2-3h6l2 3h4v12H3V8Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinejoin="round"
                />
                <circle
                  cx="12"
                  cy="13.5"
                  r="3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                />
              </svg>
            </span>
          </button>
          <div className="chat-dock-who">
            <b>{me}</b>
            {/* Keyed so each new status slides in. */}
            <span key={status}>{status}</span>
          </div>
          <button
            type="button"
            className={tray ? 'chat-dock-button is-open' : 'chat-dock-button'}
            onClick={() => setTray(!tray)}
            aria-expanded={tray}
            aria-controls="chat-stickers"
            aria-label="Figurinhas"
            title="Figurinhas"
            disabled={waiting > 0}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M14 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h7l8-8V6a3 3 0 0 0-3-3h-4Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M13 21v-5a3 3 0 0 1 3-3h5M8.5 10h.01M14.5 10h.01M8.5 14.5s1.2 1.5 3 1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="submit"
            className="chat-dock-button is-primary"
            disabled={writing && (sending || waiting > 0)}
          >
            {writing ? (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 11.5 21 3l-8.5 18-2-7.5L3 11.5Z" fill="currentColor" />
                </svg>
                {waiting > 0 ? `${waiting}s` : 'Enviar'}
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 5h16v11H9l-5 4V5Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </svg>
                Escrever
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
