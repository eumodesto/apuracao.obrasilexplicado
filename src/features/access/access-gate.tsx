'use client';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import '@/app/login/login.css';
import { STICKER_PACKS } from '@/lib/access/packs';
import type { AccessStatus } from '@/lib/access/types';
import type { CheckoutItem, PixCharge } from './checkout';
import { brl, clock } from './format';
import './access.css';

/** Paywall / shop JS (Mercado Pago Brick, login form) stays off the election first paint. */
const PasswordForm = lazy(() =>
  import('@/app/login/password-form').then((module) => ({ default: module.PasswordForm })),
);
const Checkout = lazy(() =>
  import('./checkout').then((module) => ({ default: module.Checkout })),
);
const PixPaymentPanel = lazy(() =>
  import('./checkout').then((module) => ({ default: module.PixPaymentPanel })),
);

/** Also how fast a device notices that the account signed in somewhere else. */
// Every 20 s: result requests also count watched time, so this mostly checks the session.
const HEARTBEAT_MS = 20000;

type AccessContextValue = {
  status: AccessStatus;
  /** Opens the access dialog without waiting for the free time to end. */
  offerAccess: () => void;
  /** Opens the sticker shop (paid access only). */
  buyStickers: () => void;
  /** Mirrors the sticker balance after sending one. */
  setStickers: (stickers: number) => void;
};
const AccessContext = createContext<AccessContextValue | null>(null);

/** Access state for components inside the panel, such as the chat. */
export function useAccess() {
  const value = useContext(AccessContext);
  if (!value) throw new Error('useAccess must be used inside AccessGate');
  return value;
}

/** Element inside the floating badge where other features can place a button (chat launcher). */
export const BADGE_SLOT_ID = 'access-badge-slot';

/**
 * Free time is counted on the server; this only mirrors it. When it ends: a visitor is asked to
 * create an account (without mentioning the free minute); only after sign-up does an unlocked
 * account see the payment offer (Pix or card).
 */
export function AccessGate({
  initial,
  simulatedPayment,
  publicKey,
  children,
}: {
  initial: AccessStatus;
  simulatedPayment: boolean;
  /** Mercado Pago public key for the card form; null without card payments. */
  publicKey: string | null;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState(initial);
  const [remaining, setRemaining] = useState(initial.remainingSeconds);
  const left = useRef(initial.remainingSeconds);
  const [offer, setOffer] = useState(false);
  const [shop, setShop] = useState(false);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const locked = status.state === 'locked';
  const offerAccess = useCallback(() => setOffer(true), []);
  const closeOffer = useCallback(() => setOffer(false), []);
  const buyStickers = useCallback(() => setShop(true), []);
  const setStickers = useCallback(
    (stickers: number) => setStatus((current) => ({ ...current, stickers })),
    [],
  );

  const heartbeat = useCallback(async () => {
    try {
      const response = await fetch('/api/access', { method: 'POST' });
      if (response.status === 401 || response.status === 403) {
        const body = await response.json().catch(() => ({}));
        // A full navigation also stops every poll still running on this page.
        return window.location.assign(
          body.code === 'replaced'
            ? '/login?erro=outro-aparelho'
            : body.code === 'onboarding'
              ? '/cadastro'
              : body.code === 'paused'
                ? '/login?erro=suspensa'
                : body.code === 'deleted'
                  ? '/login?erro=excluida'
                  : '/',
        );
      }
      if (!response.ok) return;
      const next: AccessStatus = await response.json();
      left.current = next.remainingSeconds;
      // Paid while locked out: the page was served without results, so load it again.
      if (statusRef.current.state === 'locked' && next.state === 'paid')
        return window.location.reload();
      setStatus(next);
      setRemaining(next.remainingSeconds);
    } catch {
      // Offline: the next beat retries; the server keeps the authoritative count.
    }
  }, []);

  // Runs for paid users too: it is what signs this device out when the account logs in elsewhere.
  useEffect(() => {
    const beat = setInterval(() => !document.hidden && heartbeat(), HEARTBEAT_MS);
    const onVisible = () => !document.hidden && heartbeat();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [heartbeat]);

  useEffect(() => {
    // Free time is counted on the server from the first visit; this clock only mirrors it.
    if (status.state !== 'free' || status.waiting) return;
    const tick = setInterval(() => {
      if (document.hidden || left.current <= 0) return;
      left.current -= 1;
      setRemaining(left.current);
      // Confirm with the server as soon as the local countdown ends.
      if (left.current === 0) heartbeat();
    }, 1000);
    return () => clearInterval(tick);
  }, [status.state, status.waiting, heartbeat]);

  const paywall = locked || offer;
  return (
    <AccessContext.Provider value={{ status, offerAccess, buyStickers, setStickers }}>
      <div className="access-content" inert={paywall || shop}>
        {children}
      </div>
      <AccessBadge status={status} remaining={remaining} />
      {paywall && (
        <Paywall
          status={status}
          simulatedPayment={simulatedPayment}
          publicKey={publicKey}
          // Only an offer opened by choice can be dismissed; the end of free time cannot.
          onClose={locked ? undefined : closeOffer}
        />
      )}
      {shop && !paywall && (
        <StickerShop
          status={status}
          simulatedPayment={simulatedPayment}
          publicKey={publicKey}
          onBought={() => heartbeat()}
          onClose={() => setShop(false)}
        />
      )}
    </AccessContext.Provider>
  );
}

function AccessBadge({ status, remaining }: { status: AccessStatus; remaining: number }) {
  const { offerAccess } = useAccess();
  return (
    <div className="access-badge" role="status">
      <span id={BADGE_SLOT_ID} className="access-badge-slot" />
      {status.user.username && (
        <span
          className="access-badge-user"
          title={status.user.username ? `@${status.user.username}` : status.user.email || undefined}
        >
          {status.guest ? status.user.username : `@${status.user.username}`}
        </span>
      )}
      {status.state === 'free' && status.waiting && (
        <span className="access-badge-time">
          Grátis: <b>{clock(remaining)}</b>
          <span className="access-badge-wait"> · começa a contar com a apuração</span>
          <span className="access-badge-wait-short"> · pausado até a apuração</span>
        </span>
      )}
      {status.state === 'free' && !status.waiting && (
        <span className={remaining <= 60 ? 'access-badge-time is-ending' : 'access-badge-time'}>
          Grátis: <b>{clock(remaining)}</b>
        </span>
      )}
      {status.state === 'paid' && (
        <span className="access-badge-time">
          {status.staff
            ? 'Acesso da equipe'
            : status.granted
              ? 'Acesso liberado'
              : 'Acesso vitalício'}
        </span>
      )}
      {status.guest ? (
        <button type="button" className="access-badge-logout" onClick={offerAccess}>
          Entrar
        </button>
      ) : (
        <form method="post" action="/api/auth/logout">
          <button
            type="submit"
            className="access-badge-logout"
            title={status.user.username ? `@${status.user.username}` : status.user.email}
          >            Sair
          </button>
        </form>
      )}
    </div>
  );
}

function Dialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="paywall-backdrop"
      onClick={(event) => onClose && event.target === event.currentTarget && onClose()}
    >
      <section className="paywall" role="dialog" aria-modal="true" aria-labelledby={label}>
        {onClose && (
          <button type="button" className="paywall-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        )}
        <p className="paywall-eyebrow">Resultados Brasil · Eleições 2026</p>
        {children}
      </section>
    </div>
  );
}

function Paywall({
  status,
  simulatedPayment,
  publicKey,
  onClose,
}: {
  status: AccessStatus;
  simulatedPayment: boolean;
  publicKey: string | null;
  onClose?: () => void;
}) {
  const [paid, setPaid] = useState(false);
  const [pix, setPix] = useState<PixCharge | null>(null);
  const done = useCallback(() => setPaid(true), []);
  // After paying, the page loads again with every result (the locked page was served without).
  useEffect(() => {
    if (!paid) return;
    const timer = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(timer);
  }, [paid]);

  // Visitors: only ask for sign-up / sign-in. Never mention the free minute; payment comes after.
  if (status.guest)
    return (
      <Dialog label="paywall-title" onClose={onClose}>
        <h2 id="paywall-title">Crie sua conta para continuar</h2>
        <p className="paywall-text">
          Para seguir com a apuração ao vivo e o chat, crie sua conta. É rápido: escolha um @nome
          (sem espaços), um e-mail e uma senha.
        </p>
        <div className="paywall-auth">
          <Suspense fallback={<p className="paywall-waiting">Carregando…</p>}>
            <PasswordForm next="/" initialMode="criar" emphasizeSignup />
          </Suspense>
        </div>
      </Dialog>
    );

  // Second step: QR Code alone, after "Pagar com Pix".
  if (pix && !paid)
    return (
      <Dialog label="pix-title">
        <h2 id="pix-title">Pague com Pix</h2>
        <Suspense fallback={<p className="paywall-waiting">Carregando Pix…</p>}>
          <PixPaymentPanel
            pix={pix}
            simulated={simulatedPayment}
            onPaid={done}
            onExpired={() => setPix(null)}
          />
        </Suspense>
        <button type="button" className="shop-back" onClick={() => setPix(null)}>
          ← Voltar
        </button>
      </Dialog>
    );

  return (
    <Dialog label="paywall-title" onClose={onClose}>
      {paid ? (
        <>
          <h2 id="paywall-title">Pagamento confirmado</h2>
          <p className="paywall-text" aria-live="polite">
            Obrigado! Acesso liberado para sempre. Abrindo o painel…
          </p>
        </>
      ) : (
        <>
          <h2 id="paywall-title">
            {onClose ? 'Libere a apuração completa' : 'Ajude e continue com a apuração'}
          </h2>
          <figure className="paywall-cause">
            <img
              src="/access/natal-criancas.jpg"
              alt="Crianças celebrando o Natal com uma árvore iluminada e presentes"
              width={880}
              height={495}
            />
            <figcaption>
              Parte dos <b>{brl(status.price)}</b> vai para crianças carentes terem um Natal melhor.
            </figcaption>
          </figure>
          <p className="paywall-text">
            Pagamento único de <b>{brl(status.price)}</b> pelo Mercado Pago (Pix ou cartão). Depois
            disso, o painel fica liberado <b>para sempre</b>, sem limite de tempo.
          </p>
          <ul className="paywall-list">
            <li>Acesso vitalício à apuração e ao chat</li>
            <li>Resultados oficiais do TSE ao vivo</li>
            <li>Mapa por estado, município e zona</li>
            <li>Parte do valor ajuda o Natal de crianças carentes</li>
          </ul>
          <Suspense fallback={<p className="paywall-waiting">Carregando pagamento…</p>}>
            <Checkout
              item={{ amount: status.price }}
              publicKey={publicKey}
              simulated={simulatedPayment}
              email={status.user.email}
              onPaid={done}
              onPixReady={setPix}
            />
          </Suspense>
        </>
      )}
      <form className="paywall-account" method="post" action="/api/auth/logout">
        <span>
          Conectado como{' '}
          {status.user.username ? `@${status.user.username}` : status.user.name || status.user.email}
        </span>
        <button type="submit">Sair</button>
      </form>
    </Dialog>
  );
}

/** Sticker packs: choose one, pay with Pix or card, and the stickers are added to the balance. */
function StickerShop({
  status,
  simulatedPayment,
  publicKey,
  onBought,
  onClose,
}: {
  status: AccessStatus;
  simulatedPayment: boolean;
  publicKey: string | null;
  onBought: () => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState<(CheckoutItem & { credits: number }) | null>(null);
  const [bought, setBought] = useState<number | null>(null);
  const done = useCallback(() => {
    setBought(item?.credits ?? null);
    onBought();
  }, [item, onBought]);
  return (
    <Dialog label="shop-title" onClose={onClose}>
      {bought !== null ? (
        <>
          <h2 id="shop-title">Figurinhas liberadas</h2>
          <p className="paywall-text" aria-live="polite">
            {bought} {bought === 1 ? 'envio foi adicionado' : 'envios foram adicionados'}. Bom chat!
          </p>
          <button type="button" className="paywall-pay" onClick={onClose}>
            Voltar ao chat
          </button>
        </>
      ) : item ? (
        <>
          <h2 id="shop-title">
            {item.credits} envios por {brl(item.amount)}
          </h2>
          <Suspense fallback={<p className="paywall-waiting">Carregando pagamento…</p>}>
            <Checkout
              item={item}
              publicKey={publicKey}
              simulated={simulatedPayment}
              email={status.user.email}
              onPaid={done}
            />
          </Suspense>
          <button type="button" className="shop-back" onClick={() => setItem(null)}>
            ← Escolher outro pacote
          </button>
        </>
      ) : (
        <>
          <h2 id="shop-title">Figurinhas para o chat</h2>
          <p className="paywall-text">
            Você tem <b>{status.stickers}</b>{' '}
            {status.stickers === 1 ? 'envio' : 'envios'}. Cada envio gasta 1 — pode repetir a mesma
            figurinha.
          </p>
          <div className="shop-packs">
            {STICKER_PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                className="shop-pack"
                onClick={() =>
                  setItem({ pack: pack.id, amount: pack.price, credits: pack.credits })
                }
              >
                <b>{pack.credits}</b>
                <span>envios</span>
                <em>{brl(pack.price)}</em>
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
