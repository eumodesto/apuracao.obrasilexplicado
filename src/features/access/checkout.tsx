'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { brl } from './format';

const PAYMENT_POLL_MS = 4000;
const SDK_URL = 'https://sdk.mercadopago.com/js/v2';

type Pix = {
  id: string;
  amount: number;
  qrCode: string;
  qrCodeBase64: string | null;
  expiresAt: string;
  simulated: boolean;
};

/** What is being bought: access (no pack) or a sticker pack. */
export type CheckoutItem = { pack?: string; amount: number };

/**
 * Pix or card for one purchase. Pix shows the copy-and-paste code and waits for the bank; the card
 * form is Mercado Pago's own (Bricks): the card number goes from the browser to Mercado Pago, which
 * returns a token, and only the token reaches this site. `onPaid` runs once it is approved.
 */
export function Checkout({
  item,
  publicKey,
  simulated,
  onPaid,
}: {
  item: CheckoutItem;
  publicKey: string | null;
  simulated: boolean;
  onPaid: () => void;
}) {
  const [method, setMethod] = useState<'pix' | 'card'>('pix');
  return (
    <div className="checkout">
      <div className="checkout-tabs" role="tablist" aria-label="Forma de pagamento">
        {(['pix', 'card'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={method === value}
            className={method === value ? 'is-active' : undefined}
            onClick={() => setMethod(value)}
          >
            {value === 'pix' ? 'Pix' : 'Cartão'}
          </button>
        ))}
      </div>
      {method === 'pix' ? (
        <PixPane item={item} simulated={simulated} onPaid={onPaid} />
      ) : (
        <CardPane item={item} publicKey={publicKey} simulated={simulated} onPaid={onPaid} />
      )}
    </div>
  );
}

function PixPane({
  item,
  simulated,
  onPaid,
}: {
  item: CheckoutItem;
  simulated: boolean;
  onPaid: () => void;
}) {
  const [pix, setPix] = useState<Pix | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/billing/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.pack ? { pack: item.pack } : {}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (!item.pack && body.access?.state === 'paid') return onPaid();
      setPix(body.payment);
    } catch (problem) {
      setError(problem instanceof Error && problem.message ? problem.message : 'Falha de conexão.');
    } finally {
      setLoading(false);
    }
  };

  const pixId = pix?.id ?? null;
  useEffect(() => {
    if (!pixId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const response = await fetch('/api/billing/status');
        const body = await response.json();
        if (stopped) return;
        if (body.paymentStatus === 'approved' || (!item.pack && body.access?.state === 'paid'))
          return onPaid();
        if (body.paymentStatus === 'rejected' || body.paymentStatus === 'cancelled') {
          setPix(null);
          return setError('O pagamento não foi aprovado. Gere um novo Pix.');
        }
      } catch {
        // Keep waiting; the next check retries.
      }
      if (!stopped) timer = setTimeout(check, PAYMENT_POLL_MS);
    };
    timer = setTimeout(check, PAYMENT_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pixId, item.pack, onPaid]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  if (!pix)
    return (
      <div className="checkout-pane">
        {error && (
          <p className="paywall-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="paywall-pay" onClick={open} disabled={loading}>
          {loading ? 'Gerando o Pix…' : `Pagar ${brl(item.amount)} com Pix`}
        </button>
      </div>
    );
  return (
    <div className="checkout-pane">
      <p className="paywall-text">
        Copie o código e cole no app do seu banco, em <b>Pix Copia e Cola</b>, ou leia o QR Code com
        outro celular.
      </p>
      <div className="paywall-qr-wide">
        <PixQr pix={pix} />
      </div>
      <label className="paywall-code-label" htmlFor="pix-code">
        Pix copia e cola
      </label>
      <div className="paywall-code">
        <input id="pix-code" readOnly value={pix.qrCode} onFocus={(e) => e.target.select()} />
        <button type="button" onClick={() => copy(pix.qrCode)}>
          {copied ? 'Código copiado!' : 'Copiar código Pix'}
        </button>
      </div>
      <details className="paywall-qr-narrow">
        <summary>Mostrar QR Code para pagar em outro aparelho</summary>
        <PixQr pix={pix} />
      </details>
      <p className="paywall-waiting" aria-live="polite">
        <span className="paywall-spinner" aria-hidden="true" />
        Aguardando a confirmação do pagamento…
      </p>
      <p className="paywall-fine">
        O código vale até{' '}
        {new Date(pix.expiresAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Sao_Paulo',
        })}
        . A liberação é automática assim que o banco confirmar.
      </p>
      {pix.simulated && simulated && (
        <button
          type="button"
          className="paywall-dev"
          onClick={() => fetch('/api/billing/dev-approve', { method: 'POST' })}
        >
          Simular Pix aprovado (apenas em desenvolvimento)
        </button>
      )}
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

type BrickController = { unmount: () => void };
type MercadoPagoSdk = new (
  key: string,
  options: { locale: string },
) => {
  bricks: () => {
    create: (kind: 'cardPayment', container: string, settings: object) => Promise<BrickController>;
  };
};

let sdk: Promise<MercadoPagoSdk> | null = null;
/** Mercado Pago's script, loaded once and only when someone opens the card tab. */
function loadSdk() {
  sdk ??= new Promise<MercadoPagoSdk>((resolve, reject) => {
    const ready = () => (window as unknown as { MercadoPago: MercadoPagoSdk }).MercadoPago;
    if (ready()) return resolve(ready());
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve(ready());
    script.onerror = () => {
      sdk = null;
      reject(new Error('sdk'));
    };
    document.head.appendChild(script);
  });
  return sdk;
}

function CardPane({
  item,
  publicKey,
  simulated,
  onPaid,
}: {
  item: CheckoutItem;
  publicKey: string | null;
  simulated: boolean;
  onPaid: () => void;
}) {
  const container = `card-brick-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(!!publicKey);
  const paid = useRef(onPaid);
  useEffect(() => {
    paid.current = onPaid;
  }, [onPaid]);

  const charge = async (form: object) => {
    const response = await fetch('/api/billing/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, pack: item.pack }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Não foi possível processar o cartão.');
    if (body.status === 'approved') return paid.current();
    setMessage({
      error: body.status !== 'pending',
      text: body.message ?? 'Pagamento recusado. Confira os dados ou use o Pix.',
    });
    throw new Error(body.message ?? 'recusado');
  };

  useEffect(() => {
    if (!publicKey) return;
    let controller: BrickController | null = null;
    let cancelled = false;
    loadSdk()
      .then((MercadoPago) =>
        new MercadoPago(publicKey, { locale: 'pt-BR' }).bricks().create('cardPayment', container, {
          initialization: { amount: item.amount },
          customization: {
            visual: { style: { theme: 'dark' } },
            paymentMethods: { maxInstallments: 1 },
          },
          callbacks: {
            onReady: () => !cancelled && setLoading(false),
            onSubmit: (form: object) => {
              setMessage(null);
              return charge(form).catch((problem: Error) => {
                setMessage((current) => current ?? { error: true, text: problem.message });
                throw problem;
              });
            },
            onError: () =>
              !cancelled &&
              setMessage({
                error: true,
                text: 'Não foi possível carregar o pagamento com cartão.',
              }),
          },
        }),
      )
      .then((created) => {
        if (cancelled) created.unmount();
        else controller = created;
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setMessage({ error: true, text: 'Não foi possível carregar o cartão. Use o Pix.' });
        }
      });
    return () => {
      cancelled = true;
      controller?.unmount();
    };
    // The form is built once per item; `charge` reads the latest callbacks through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, item.amount, item.pack, container]);

  if (!publicKey)
    return (
      <div className="checkout-pane">
        {simulated ? (
          <button
            type="button"
            className="paywall-dev"
            onClick={() =>
              charge({}).catch((problem: Error) =>
                setMessage({ error: true, text: problem.message }),
              )
            }
          >
            Simular cartão aprovado · {brl(item.amount)} (apenas em desenvolvimento)
          </button>
        ) : (
          <p className="paywall-text">
            O pagamento com cartão ainda não está disponível. Use o Pix.
          </p>
        )}
        {message && (
          <p className={message.error ? 'paywall-error' : 'paywall-text'} role="alert">
            {message.text}
          </p>
        )}
      </div>
    );
  return (
    <div className="checkout-pane">
      {loading && (
        <p className="paywall-waiting">
          <span className="paywall-spinner" aria-hidden="true" />
          Carregando o pagamento seguro do Mercado Pago…
        </p>
      )}
      <div id={container} className="checkout-card" />
      {message && (
        <p className={message.error ? 'paywall-error' : 'paywall-text'} role="alert">
          {message.text}
        </p>
      )}
      <p className="paywall-fine">
        Os dados do cartão vão direto para o Mercado Pago; este site não vê nem guarda o número.
      </p>
    </div>
  );
}
