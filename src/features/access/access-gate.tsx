'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessStatus } from '@/lib/access/types';
import { brl, clock } from './format';
import './access.css';

const HEARTBEAT_MS = 15000;
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
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [remaining, setRemaining] = useState(initial.remainingSeconds);
  const left = useRef(initial.remainingSeconds);
  const locked = status.state === 'locked';

  const heartbeat = useCallback(async () => {
    try {
      const response = await fetch('/api/access', { method: 'POST' });
      if (response.status === 401) return router.replace('/login');
      if (!response.ok) return;
      const next: AccessStatus = await response.json();
      left.current = next.remainingSeconds;
      setStatus(next);
      setRemaining(next.remainingSeconds);
    } catch {
      // Offline: the next beat retries; the server keeps the authoritative count.
    }
  }, [router]);

  useEffect(() => {
    if (status.state === 'paid') return;
    const beat = setInterval(() => !document.hidden && heartbeat(), HEARTBEAT_MS);
    const onVisible = () => !document.hidden && heartbeat();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status.state, heartbeat]);

  useEffect(() => {
    if (status.state !== 'free') return;
    const tick = setInterval(() => {
      if (document.hidden || left.current <= 0) return;
      left.current -= 1;
      setRemaining(left.current);
      // Confirm with the server as soon as the local countdown ends.
      if (left.current === 0) heartbeat();
    }, 1000);
    return () => clearInterval(tick);
  }, [status.state, heartbeat]);

  return (
    <>
      <div className="access-content" inert={locked}>
        {children}
      </div>
      <AccessBadge status={status} remaining={remaining} />
      {locked && <Paywall status={status} simulatedPayment={simulatedPayment} />}
    </>
  );
}

function AccessBadge({ status, remaining }: { status: AccessStatus; remaining: number }) {
  return (
    <div className="access-badge" role="status">
      {status.state === 'free' && (
        <span className={remaining <= 60 ? 'access-badge-time is-ending' : 'access-badge-time'}>
          Grátis: <b>{clock(remaining)}</b>
        </span>
      )}
      {status.state === 'paid' && <span className="access-badge-time">Acesso liberado</span>}
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
}: {
  status: AccessStatus;
  simulatedPayment: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ name: 'offer' });
  const [copied, setCopied] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const until = new Date(status.paidUntil).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });

  useEffect(() => primary.current?.focus(), [phase.name]);

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

  // Reload so the panel starts again with the full data.
  useEffect(() => {
    if (phase.name !== 'paid') return;
    const timer = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(timer);
  }, [phase.name]);

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
    <div className="paywall-backdrop">
      <section
        className="paywall"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        aria-describedby="paywall-text"
      >
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
              Abra o app do seu banco, escolha Pix e leia o QR Code ou cole o código abaixo.
            </p>
            {phase.pix.qrCodeBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="paywall-qr"
                src={`data:image/png;base64,${phase.pix.qrCodeBase64}`}
                alt="QR Code do Pix"
                width={220}
                height={220}
              />
            ) : (
              <div className="paywall-qr is-simulated">QR Code simulado</div>
            )}
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
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
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
            <h2 id="paywall-title">Seu tempo grátis acabou</h2>
            <p id="paywall-text" className="paywall-text">
              Continue acompanhando a apuração em tempo real até o resultado final por{' '}
              <b>{brl(status.price)}</b>, pago uma única vez no Pix.
            </p>
            <ul className="paywall-list">
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
