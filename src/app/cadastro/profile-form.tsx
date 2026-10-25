'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Party } from '@/lib/profile/parties';

type Check = { state: 'idle' | 'checking' | 'ok' | 'error'; message?: string | null };
type Errors = Partial<Record<'username' | 'email' | 'party' | 'form', string>>;

const CHECK_DELAY_MS = 400;
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function ProfileForm({
  parties,
  noParty,
  suggestion,
  lockedUsername = null,
  needsEmail = false,
}: {
  parties: Party[];
  noParty: string;
  suggestion: string;
  /** Username already chosen at sign-up — only the party remains. */
  lockedUsername?: string | null;
  /** Legacy accounts created without e-mail still need one for Pix. */
  needsEmail?: boolean;
}) {
  const router = useRouter();
  const locked = !!lockedUsername;
  const [username, setUsername] = useState(lockedUsername ?? suggestion);
  const [email, setEmail] = useState('');
  const [check, setCheck] = useState<Check>({ state: locked ? 'ok' : 'idle' });
  const [party, setParty] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const usernameRef = useRef(username);
  const emailRef = useRef(email);
  const checkRef = useRef(check);
  usernameRef.current = username;
  emailRef.current = email;
  checkRef.current = check;

  // Checks availability while typing, keeping only the answer for the latest text.
  useEffect(() => {
    if (locked) return;
    const value = username.trim().replace(/^@/, '');
    if (!value) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCheck({ state: 'checking' });
      try {
        const response = await fetch(`/api/profile/username?u=${encodeURIComponent(value)}`, {
          signal: controller.signal,
        });
        if (response.status === 401) return router.replace('/login');
        const body = await response.json();
        setCheck(
          body.available ? { state: 'ok' } : { state: 'error', message: body.message ?? null },
        );
      } catch {
        if (!controller.signal.aborted) setCheck({ state: 'idle' });
      }
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username, router, locked]);

  const finish = async (chosen: string) => {
    if (sending) return;
    const name = usernameRef.current.trim().replace(/^@/, '');
    const mail = emailRef.current.trim().toLowerCase();
    const next: Errors = {};
    if (!name) next.username = 'Escolha um nome de usuário.';
    else if (!locked) {
      if (checkRef.current.state === 'error')
        next.username = checkRef.current.message ?? 'Esse nome não pode ser usado.';
      else if (checkRef.current.state === 'checking' || checkRef.current.state === 'idle')
        next.username = 'Aguarde a verificação do nome de usuário.';
    }
    if (needsEmail) {
      if (!mail) next.email = 'Digite um e-mail.';
      else if (!emailOk(mail)) next.email = 'Digite um e-mail válido.';
    }
    setErrors(next);
    if (Object.keys(next).length) {
      if (next.username) usernameInput.current?.focus();
      else if (next.email) emailInput.current?.focus();
      return;
    }
    setParty(chosen);
    setSending(true);
    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Choosing a side is the authorization to show it on the chat badge.
        body: JSON.stringify({
          username: name,
          party: chosen,
          consent: chosen !== noParty,
          ...(needsEmail ? { email: mail } : {}),
        }),
      });
      if (response.status === 401) return router.replace('/login');
      const body = await response.json();
      if (!response.ok) {
        setErrors({ [body.field ?? 'form']: body.error ?? 'Não foi possível salvar.' });
        if (body.field === 'username') {
          setCheck({ state: 'error', message: body.error });
          usernameInput.current?.focus();
        } else if (body.field === 'email') emailInput.current?.focus();
        setParty('');
        return setSending(false);
      }
      router.replace('/');
    } catch {
      setErrors({ form: 'Falha de conexão. Tente novamente.' });
      setParty('');
      setSending(false);
    }
  };

  const usernameMessage =
    errors.username ??
    (check.state === 'error'
      ? check.message
      : check.state === 'ok'
        ? 'Disponível ✓'
        : check.state === 'checking'
          ? 'Verificando…'
          : null);

  return (
    <form
      className="signup-form"
      onSubmit={(event) => event.preventDefault()}
      noValidate
      aria-busy={sending}
    >
      {locked ? (
        <p className="signup-help">
          Seu nome no chat: <b>@{lockedUsername}</b>
        </p>
      ) : (
        <>
          <label className="signup-label" htmlFor="username">
            Nome de usuário
          </label>
          <div className={`signup-username is-${errors.username ? 'error' : check.state}`}>
            <span aria-hidden="true">@</span>
            <input
              ref={usernameInput}
              id="username"
              name="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setErrors((current) => ({ ...current, username: undefined }));
                if (!e.target.value.trim()) setCheck({ state: 'idle' });
              }}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={21}
              disabled={sending}
              aria-describedby="username-help username-status"
              aria-invalid={!!errors.username || check.state === 'error'}
            />
          </div>
          <p
            id="username-status"
            className={`signup-status is-${errors.username ? 'error' : check.state}`}
            aria-live="polite"
          >
            {usernameMessage}
          </p>
          <p id="username-help" className="signup-help">
            De 3 a 20 caracteres: letras sem acento, números, ponto e sublinhado. Ninguém mais pode
            usar o mesmo nome.
          </p>
        </>
      )}

      {needsEmail && (
        <>
          <label className="signup-label" htmlFor="signup-email">
            E-mail
          </label>
          <input
            ref={emailInput}
            id="signup-email"
            className="login-input"
            name="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value.trim());
              setErrors((current) => ({ ...current, email: undefined }));
            }}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={120}
            disabled={sending}
            aria-invalid={!!errors.email}
            aria-describedby="signup-email-help"
          />
          {errors.email && (
            <p className="signup-status is-error" role="alert">
              {errors.email}
            </p>
          )}
          <p id="signup-email-help" className="signup-help">
            Usado no Pix e em avisos da conta. Não substitui o @nome.
          </p>
        </>
      )}

      <fieldset
        className="signup-parties"
        disabled={sending}
        aria-describedby={errors.party ? 'party-error' : undefined}
      >
        <legend className="signup-label">Quem você apoia para Presidente</legend>
        <p className="signup-help signup-pick-hint">
          {sending ? 'Abrindo o painel…' : 'Toque em um lado para continuar.'}
        </p>
        <div className="signup-sides">
          {parties.map((option) => (
            <SideCard
              key={option.code}
              party={option}
              checked={party === option.code}
              dimmed={party !== '' && party !== option.code}
              disabled={sending}
              onChange={finish}
            />
          ))}
        </div>
        <label className={party === noParty ? 'signup-neutral is-checked' : 'signup-neutral'}>
          <input
            type="radio"
            name="party"
            value={noParty}
            checked={party === noParty}
            disabled={sending}
            onChange={() => finish(noParty)}
          />
          <span>Prefiro não informar</span>
        </label>
        {errors.party && (
          <p id="party-error" className="signup-status is-error" role="alert">
            {errors.party}
          </p>
        )}
      </fieldset>

      {errors.form && (
        <p className="login-error" role="alert">
          {errors.form}
        </p>
      )}
    </form>
  );
}

/** Big image button for one side: color, number and arrows pointing to the side. No faces. */
function SideCard({
  party,
  checked,
  dimmed,
  disabled,
  onChange,
}: {
  party: Party;
  checked: boolean;
  dimmed: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const left = party.side === 'esquerda';
  return (
    <label
      className={`signup-side is-${party.side}${checked ? ' is-checked' : ''}${dimmed ? ' is-dimmed' : ''}`}
      style={{ '--side': party.color } as React.CSSProperties}
      title={party.name}
    >
      <input
        type="radio"
        name="party"
        value={party.code}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(party.code)}
      />
      <svg className="signup-side-art" viewBox="0 0 200 240" aria-hidden="true">
        <defs>
          <pattern
            id={`stripes-${party.code}`}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${left ? 45 : -45})`}
          >
            <rect width="4" height="10" fill="#fff" opacity="0.06" />
          </pattern>
        </defs>
        <rect width="200" height="240" fill={`url(#stripes-${party.code})`} />
        {/* Mirrored for the right side, so both animate the same way: outward. */}
        <g transform={left ? undefined : 'translate(200 0) scale(-1 1)'}>
          <g className="signup-side-arrows">
            {[0, 1, 2].map((i) => (
              <path
                key={i}
                d={`M${78 + i * 34} 64 L${38 + i * 34} 120 L${78 + i * 34} 176`}
                fill="none"
                stroke="#fff"
                strokeWidth="14"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.1 + i * 0.07}
              />
            ))}
          </g>
        </g>
      </svg>
      <span className="signup-side-check" aria-hidden="true">
        ✓
      </span>
      <span className="signup-side-text">
        <span className="signup-side-kicker">{left ? '← Esquerda' : 'Direita →'}</span>
        <span className="signup-side-number">{party.number}</span>
        <span className="signup-side-party">{party.code}</span>
      </span>
    </label>
  );
}
