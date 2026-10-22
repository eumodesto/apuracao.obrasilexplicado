'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';

const two = (value: number) => String(value).padStart(2, '0');

/** "5 dias · 00:56:03", "1 dia · 23:59:59" or, on the day, "00:56:03". */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const clock = `${two(Math.floor((total % 86_400) / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
  return days > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'} · ${clock}` : clock;
}

const subscribeSecond = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
};
const nowSecond = () => Math.floor(Date.now() / 1000);

export function CountdownClock({ startsAt }: { startsAt: number }) {
  // Server render shows nothing time-dependent; the browser fills in its own clock.
  const second = useSyncExternalStore(subscribeSecond, nowSecond, () => null);
  const left = second === null ? null : startsAt - second * 1000;

  // When the time comes, reload: the server then serves the panel.
  useEffect(() => {
    if (left !== null && left <= 0) window.location.reload();
  }, [left]);

  return (
    <strong className="landing-clock" suppressHydrationWarning>
      {left === null ? '—' : formatCountdown(left)}
    </strong>
  );
}

type FormState =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'done'; email: string; already: boolean }
  | { name: 'error'; message: string };

export function NotifyForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<FormState>({ name: 'idle' });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ name: 'sending' });
    try {
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        return setState({ name: 'error', message: body.error ?? 'Não foi possível salvar.' });
      setState({ name: 'done', email: email.trim(), already: !!body.already });
    } catch {
      setState({ name: 'error', message: 'Falha de conexão. Tente de novo.' });
    }
  };

  if (state.name === 'done')
    return (
      <div className="landing-notify is-done" role="status">
        <p>
          <b>Pronto!</b> {state.already ? 'Esse e-mail já estava na lista.' : 'Você está na lista.'}{' '}
          Avisamos em <b>{state.email}</b> quando a contagem começar.
        </p>
      </div>
    );

  return (
    <form className="landing-notify" onSubmit={submit} noValidate>
      <label htmlFor="notify-email">Avisamos por e-mail quando a contagem começar.</label>
      <div className="landing-notify-row">
        <input
          id="notify-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="seu@email.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state.name === 'error') setState({ name: 'idle' });
          }}
          aria-invalid={state.name === 'error'}
          aria-describedby="notify-help"
          required
        />
        <button type="submit" disabled={state.name === 'sending'}>
          {state.name === 'sending' ? 'Enviando…' : 'Me avise'}
        </button>
      </div>
      {state.name === 'error' ? (
        <p id="notify-help" className="landing-notify-error" role="alert">
          {state.message}
        </p>
      ) : (
        <p id="notify-help" className="landing-fine">
          Usamos seu e-mail só para este aviso. <a href="/privacidade">Privacidade</a>
        </p>
      )}
    </form>
  );
}
