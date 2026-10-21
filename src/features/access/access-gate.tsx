'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AccessStatus } from '@/lib/access/types';
import { brl, clock } from './format';
import './access.css';

/** Also how fast a device notices that the account signed in somewhere else. */
// Every 20 s: result requests also count watched time, so this mostly checks the session.
const HEARTBEAT_MS = 20000;
const PAYMENT_POLL_MS = 4000;

type Pix = {
  id: string;
  amount: number;
  qrCode: string;
  qrCodeBase64: string | null;
  expiresAt: string;
  simulated: boolean;
};
type Phase =
  | { name: 'offer' }
  | { name: 'loading' }
  | { name: 'pix'; pix: Pix }
  | { name: 'paid' }
  | { name: 'error'; message: string };

type AccessContextValue = {
  status: AccessStatus;
  /** Opens the payment dialog without waiting for the free time to end (e.g. to write in the chat). */
  offerAccess: () => void;
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

/** Free time is counted on the server; this only mirrors it and asks for payment when it ends. */
export function AccessGate({
  initial,
  simulatedPayment,
  children,
}: {
  initial: AccessStatus;
  simulatedPayment: boolean;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState(initial);
  const [remaining, setRemaining] = useState(initial.remainingSeconds);
  const left = useRef(initial.remainingSeconds);
  const [offer, setOffer] = useState(false);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const locked = status.state === 'locked';
  const offerAccess = useCallback(() => setOffer(true), []);
  const closeOffer = useCallback(() => setOffer(false), []);

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
                  : '/login',
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
    // Before the count starts the server does not spend free time, so neither does the clock.
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

  // An offer stays open until it closes itself, so the buyer sees the confirmation.
  const paywall = locked || offer;
  return (
    <AccessContext.Provider value={{ status, offerAccess }}>
      <div className="access-content" inert={paywall}>
        {children}
      </div>
      <AccessBadge status={status} remaining={remaining} />
      {paywall && (
        <Paywall
          status={status}
          simulatedPayment={simulatedPayment}
          // Only an offer opened by choice can be dismissed; the end of free time cannot.
          onClose={locked ? undefined : closeOffer}
        />
      )}
    </AccessContext.Provider>
  );
}

function AccessBadge({ status, remaining }: { status: AccessStatus; remaining: number }) {
  return (
    <div className="access-badge" role="status">
      <span id={BADGE_SLOT_ID} className="access-badge-slot" />
      {status.user.username && (
        <span className="access-badge-user" title={status.user.email}>
          @{status.user.username}
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
          {status.staff ? 'Acesso da equipe' : 'Acesso liberado'}
        </span>
      )}
      <form method="post" action="/api/auth/logout">
        <button type="submit" className="access-badge-logout" title={status.user.email}>
          Sair
        </button>
      </form>
    </div>
  );
}

function Paywall({
  status,
  simulatedPayment,
  onClose,
}: {
  status: AccessStatus;
  simulatedPayment: boolean;
  onClose?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: 'offer' });
  const [copied, setCopied] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const until = new Date(status.paidUntil).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });

  useEffect(() => primary.current?.focus(), [phase.name]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openPix = async () => {
    setPhase({ name: 'loading' });
    try {
      const response = await fetch('/api/billing/pix', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (body.access?.state === 'paid') return setPhase({ name: 'paid' });
      setPhase({ name: 'pix', pix: body.payment });
    } catch (error) {
      setPhase({
        name: 'error',
        message: error instanceof Error && error.message ? error.message : 'Falha de conexão.',
      });
    }
  };

  const pixId = phase.name === 'pix' ? phase.pix.id : null;
  useEffect(() => {
    if (!pixId) return;
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch('/api/billing/status');
        const body = await response.json();
        if (!stopped && body.access?.state === 'paid') return setPhase({ name: 'paid' });
        if (!stopped && (body.paymentStatus === 'rejected' || body.paymentStatus === 'cancelled'))
          return setPhase({ name: 'error', message: 'O pagamento não foi aprovado.' });
      } catch {
        // Keep waiting; the next check retries.
      }
      if (!stopped) timer = setTimeout(check, PAYMENT_POLL_MS);
    };
    let timer = setTimeout(check, PAYMENT_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pixId]);

  // After paying: a dismissible offer just closes (the panel already has the data);
  // a locked page reloads so it starts again with the full data.
  useEffect(() => {
    if (phase.name !== 'paid') return;
    const timer = setTimeout(() => (onClose ? onClose() : window.location.reload()), 1500);
    return () => clearTimeout(timer);
  }, [phase.name, onClose]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const approveSimulated = async () => {
    await fetch('/api/billing/dev-approve', { method: 'POST' });
  };

  return (
    <div
      className="paywall-backdrop"
      onClick={(event) => onClose && event.target === event.currentTarget && onClose()}
    >
      <section
        className="paywall"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        aria-describedby="paywall-text"
      >
        {onClose && (
          <button type="button" className="paywall-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        )}
        <p className="paywall-eyebrow">Resultados Brasil · Eleições 2026</p>
        {phase.name === 'paid' ? (
          <>
            <h2 id="paywall-title">Pagamento confirmado</h2>
            <p id="paywall-text" className="paywall-text" aria-live="polite">
              Obrigado! Liberando a apuração…
            </p>
          </>
        ) : phase.name === 'pix' ? (
          <>
            <h2 id="paywall-title">Pague {brl(phase.pix.amount)} com Pix</h2>
            <p id="paywall-text" className="paywall-text">
              Copie o código e cole no app do seu banco, em <b>Pix Copia e Cola</b>, ou leia o QR
              Code com outro celular.
            </p>
            {/* Phones cannot scan their own screen: there the code comes first and the QR folds. */}
            <div className="paywall-qr-wide">
              <PixQr pix={phase.pix} />
            </div>
            <label className="paywall-code-label" htmlFor="pix-code">
              Pix copia e cola
            </label>
            <div className="paywall-code">
              <input
                id="pix-code"
                readOnly
                value={phase.pix.qrCode}
                onFocus={(e) => e.target.select()}
              />
              <button ref={primary} type="button" onClick={() => copy(phase.pix.qrCode)}>
                {copied ? 'Código copiado!' : 'Copiar código Pix'}
              </button>
            </div>
            <details className="paywall-qr-narrow">
              <summary>Mostrar QR Code para pagar em outro aparelho</summary>
              <PixQr pix={phase.pix} />
            </details>
            <p className="paywall-waiting" aria-live="polite">
              <span className="paywall-spinner" aria-hidden="true" />
              Aguardando a confirmação do pagamento…
            </p>
            <p className="paywall-fine">
              O código vale até{' '}
              {new Date(phase.pix.expiresAt).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'America/Sao_Paulo',
              })}
              . A liberação é automática assim que o banco confirmar.
            </p>
            {phase.pix.simulated && simulatedPayment && (
              <button type="button" className="paywall-dev" onClick={approveSimulated}>
                Simular pagamento aprovado (apenas em desenvolvimento)
              </button>
            )}
          </>
        ) : (
          <>
            <h2 id="paywall-title">
              {onClose ? 'Libere o chat e a apuração completa' : 'Seu tempo grátis acabou'}
            </h2>
            <p id="paywall-text" className="paywall-text">
              {onClose ? 'Escreva no chat e acompanhe' : 'Continue acompanhando'} a apuração em
              tempo real até o resultado final por <b>{brl(status.price)}</b>, pago uma única vez no
              Pix.
            </p>
            <ul className="paywall-list">
              <li>Chat ao vivo com quem está acompanhando</li>
              <li>Resultados oficiais do TSE atualizados ao vivo</li>
              <li>Mapa por estado, município e zona eleitoral</li>
              <li>Acesso até o fim da apuração ({until})</li>
            </ul>
            {phase.name === 'error' && (
              <p className="paywall-error" role="alert">
                {phase.message}
              </p>
            )}
            <button
              ref={primary}
              type="button"
              className="paywall-pay"
              onClick={openPix}
              disabled={phase.name === 'loading'}
            >
              {phase.name === 'loading'
                ? 'Gerando o Pix…'
                : phase.name === 'error'
                  ? 'Tentar novamente'
                  : `Pagar ${brl(status.price)} com Pix`}
            </button>
          </>
        )}
        <form className="paywall-account" method="post" action="/api/auth/logout">
          <span>Conectado como {status.user.email}</span>
          <button type="submit">Sair</button>
        </form>
      </section>
    </div>
  );
}

function PixQr({ pix }: { pix: Pix }) {
  return pix.qrCodeBase64 ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="paywall-qr"
      src={`data:image/png;base64,${pix.qrCodeBase64}`}
      alt="QR Code do Pix"
      width={220}
      height={220}
    />
  ) : (
    <div className="paywall-qr is-simulated">QR Code simulado</div>
  );
}
