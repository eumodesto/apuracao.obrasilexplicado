'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Party } from '@/lib/profile/parties';

type Check = { state: 'idle' | 'checking' | 'ok' | 'error'; message?: string | null };
type Errors = Partial<Record<'username' | 'party' | 'consent' | 'form', string>>;

const CHECK_DELAY_MS = 400;

export function ProfileForm({
  parties,
  noParty,
  suggestion,
}: {
  parties: Party[];
  noParty: string;
  suggestion: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(suggestion);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [party, setParty] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const needsConsent = party !== '' && party !== noParty;

  // Checks availability while typing, keeping only the answer for the latest text.
  useEffect(() => {
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
  }, [username, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (!username.trim()) next.username = 'Escolha um nome de usuário.';
    if (!party) next.party = 'Escolha uma opção.';
    if (needsConsent && !consent) next.consent = 'Marque a autorização para continuar.';
    setErrors(next);
    if (Object.keys(next).length) {
      if (next.username) usernameInput.current?.focus();
      return;
    }
    setSending(true);
    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, party, consent: needsConsent && consent }),
      });
      if (response.status === 401) return router.replace('/login');
      const body = await response.json();
      if (!response.ok) {
        setErrors({ [body.field ?? 'form']: body.error ?? 'Não foi possível salvar.' });
        if (body.field === 'username') {
          setCheck({ state: 'error', message: body.error });
          usernameInput.current?.focus();
        }
        return setSending(false);
      }
      router.replace('/');
    } catch {
      setErrors({ form: 'Falha de conexão. Tente novamente.' });
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
    <form className="signup-form" onSubmit={submit} noValidate>
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
        De 3 a 20 caracteres: letras sem acento, números, ponto e sublinhado. Ninguém mais pode usar
        o mesmo nome.
      </p>

      <fieldset
        className="signup-parties"
        aria-describedby={errors.party ? 'party-error' : undefined}
      >
        <legend className="signup-label">Partido que você apoia</legend>
        <div className="signup-party-grid">
          <PartyOption
            value={noParty}
            label="Prefiro não informar"
            color="transparent"
            checked={party === noParty}
            onChange={setParty}
          />
          {parties.map((option) => (
            <PartyOption
              key={option.code}
              value={option.code}
              label={option.number ? `${labelOf(option)} · ${option.number}` : labelOf(option)}
              title={option.name}
              color={option.color}
              checked={party === option.code}
              onChange={setParty}
            />
          ))}
        </div>
        {errors.party && (
          <p id="party-error" className="signup-status is-error" role="alert">
            {errors.party}
          </p>
        )}
      </fieldset>

      {needsConsent && (
        <div className="signup-consent">
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                setErrors((current) => ({ ...current, consent: undefined }));
              }}
            />
            <span>
              Autorizo o Resultados Brasil a guardar o partido que apoio e mostrá-lo junto do meu
              nome no chat. Posso trocar ou apagar essa informação quando quiser.
            </span>
          </label>
          <p className="signup-help">
            Opinião política é um dado sensível pela LGPD (art. 11). Ela só é usada para o selo no
            chat, nunca é vendida nem compartilhada.
          </p>
          {errors.consent && (
            <p className="signup-status is-error" role="alert">
              {errors.consent}
            </p>
          )}
        </div>
      )}

      {errors.form && (
        <p className="login-error" role="alert">
          {errors.form}
        </p>
      )}
      <button className="login-dev signup-submit" type="submit" disabled={sending}>
        {sending ? 'Salvando…' : 'Entrar no painel'}
      </button>
    </form>
  );
}

/** How the party writes its own abbreviation. */
const SPELLING: Record<string, string> = { UNIAO: 'UNIÃO', PCDOB: 'PCdoB' };
const labelOf = (party: Party) => SPELLING[party.code] ?? party.code;

function PartyOption({
  value,
  label,
  title,
  color,
  checked,
  onChange,
}: {
  value: string;
  label: string;
  title?: string;
  color: string;
  checked: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={checked ? 'signup-party is-checked' : 'signup-party'} title={title}>
      <input
        type="radio"
        name="party"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span className="signup-party-dot" style={{ background: color }} aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
