'use client';
import { useState } from 'react';

type Mode = 'entrar' | 'criar';

/** Keep username as a single token: no spaces, no leading @ (shown in the UI). */
function normalizeUsername(value: string) {
  return value.replace(/^@+/, '').replace(/\s+/g, '');
}

/** Username and password. After "Criar conta", /cadastro asks which side they support. */
export function PasswordForm({
  next,
  initialMode = 'entrar',
  emphasizeSignup = false,
  /** `/admin` keeps e-mail + password; the public panel uses @usuário. */
  variant = 'username',
}: {
  next: string;
  /** Visitors whose free minute ended start on "Criar conta". */
  initialMode?: Mode;
  /**
   * Paywall for first-time visitors: big "Criar conta", discreet link to sign in.
   * Aimed at people who need a simpler screen (larger type and clearer primary action).
   */
  emphasizeSignup?: boolean;
  variant?: 'username' | 'email';
}) {
  const emailOnly = variant === 'email';
  const [mode, setMode] = useState<Mode>(emailOnly ? 'entrar' : emphasizeSignup ? 'criar' : initialMode);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const login = emailOnly
      ? email.trim().toLowerCase()
      : normalizeUsername(username);
    if (!login)
      return setError(emailOnly ? 'Digite o e-mail.' : 'Digite um nome de usuário.');
    if (emailOnly && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login))
      return setError('Digite um e-mail válido.');
    if (!emailOnly && /\s/.test(username))
      return setError('O nome de usuário não pode ter espaços.');
    const signupEmail = email.trim().toLowerCase();
    if (!emailOnly && mode === 'criar') {
      if (!signupEmail) return setError('Digite um e-mail.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail))
        return setError('Digite um e-mail válido.');
    }
    const password = String(form.get('password') ?? '');
    if (mode === 'criar' && password !== String(form.get('confirm') ?? ''))
      return setError('As duas senhas não são iguais.');
    setSending(true);
    setError(null);
    try {
      let deviceId: string | null = null;
      try {
        deviceId = window.localStorage.getItem('rb_device');
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          window.localStorage.setItem('rb_device', deviceId);
        }
      } catch {
        deviceId = null;
      }
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: emailOnly ? 'entrar' : mode,
          login,
          username: emailOnly ? undefined : login,
          email: !emailOnly && mode === 'criar' ? signupEmail : undefined,
          password,
          next,
          deviceId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.next) {
        setSending(false);
        return setError(body.error ?? 'Não foi possível entrar. Tente de novo.');
      }
      try {
        if (typeof body.deviceId === 'string') window.localStorage.setItem('rb_device', body.deviceId);
      } catch {
        // ignore
      }
      window.location.assign(body.next);
    } catch {
      setSending(false);
      setError('Falha de conexão. Tente de novo.');
    }
  };

  const choose = (value: Mode) => {
    setMode(value);
    setError(null);
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className={emphasizeSignup ? 'login-form is-easy' : undefined}
    >
      {!emailOnly &&
        (emphasizeSignup ? (
          <p className="login-mode-switch" role="status">
            {mode === 'criar' ? (
              <>
                Já tem conta?{' '}
                <button type="button" className="login-mode-link" onClick={() => choose('entrar')}>
                  Entrar
                </button>
              </>
            ) : (
              <>
                Ainda não tem conta?{' '}
                <button type="button" className="login-mode-link" onClick={() => choose('criar')}>
                  Criar conta
                </button>
              </>
            )}
          </p>
        ) : (
          <div className="login-tabs" role="tablist" aria-label="Entrar ou criar conta">
            {(['entrar', 'criar'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                className={mode === value ? 'is-active' : undefined}
                onClick={() => choose(value)}
              >
                {value === 'entrar' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>
        ))}
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {emailOnly ? (
        <>
          <label className="login-label" htmlFor="login-email">
            E-mail
          </label>
          <input
            id="login-email"
            className="login-input"
            name="login"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value.trim())}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={120}
            required
          />
        </>
      ) : (
        <>
          <label className="login-label" htmlFor="login-id">
            Nome de usuário
          </label>
          <div className="login-username">
            <span aria-hidden="true">@</span>
            <input
              id="login-id"
              name="login"
              type="text"
              value={username}
              onChange={(event) => setUsername(normalizeUsername(event.target.value))}
              onBlur={() => setUsername((current) => normalizeUsername(current))}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={20}
              required
              aria-describedby="login-username-help"
            />
          </div>
          <p id="login-username-help" className="login-fine login-username-help">
            {mode === 'criar'
              ? 'Sem espaços. Esse @nome é só seu — nas próximas visitas, use ele com a senha. Neste celular ou computador, o site lembra de você automaticamente.'
              : 'Digite o mesmo @nome e a senha. Neste celular ou computador, o site pode lembrar de você automaticamente.'}
          </p>
          {mode === 'criar' && (
            <>
              <label className="login-label" htmlFor="signup-email">
                E-mail
              </label>
              <input
                id="signup-email"
                className="login-input"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value.trim())}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={120}
                required
              />
              <p className="login-fine">Usado no Pix e em avisos da conta. Não substitui o @nome.</p>
            </>
          )}
        </>
      )}
      <label className="login-label" htmlFor="login-password">
        Senha
      </label>
      <input
        id="login-password"
        className="login-input"
        name="password"
        type="password"
        autoComplete={mode === 'entrar' || emailOnly ? 'current-password' : 'new-password'}
        required
      />
      {!emailOnly && mode === 'criar' && (
        <>
          <label className="login-label" htmlFor="login-confirm">
            Repita a senha
          </label>
          <input
            id="login-confirm"
            className="login-input"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
        </>
      )}
      <button
        className={emphasizeSignup && mode === 'criar' ? 'login-dev' : 'login-submit'}
        type="submit"
        disabled={sending}
      >
        {sending ? 'Aguarde…' : emailOnly || mode === 'entrar' ? 'Entrar' : 'Criar minha conta'}
      </button>
      <p className="login-fine">
        {emailOnly || mode === 'entrar' ? (
          <>Esqueceu a senha? Fale com a equipe do Resultados Brasil. </>
        ) : null}
        <a href="/privacidade" target="_blank" rel="noopener">
          Política de Privacidade
        </a>
      </p>
    </form>
  );
}
