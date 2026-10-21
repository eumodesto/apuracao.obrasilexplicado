'use client';
import { useState } from 'react';

type Mode = 'entrar' | 'criar';

/** E-mail (or username) and password. "Criar conta" goes on to /cadastro for username and party. */
export function PasswordForm({
  next,
  initialMode = 'entrar',
}: {
  next: string;
  /** Visitors whose free minute ended start on "Criar conta". */
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (mode === 'criar' && password !== String(form.get('confirm') ?? ''))
      return setError('As duas senhas não são iguais.');
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          login: form.get('login'),
          email: form.get('login'),
          password,
          next,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.next) {
        setSending(false);
        return setError(body.error ?? 'Não foi possível entrar. Tente de novo.');
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
    <form onSubmit={submit} noValidate>
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
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      <label className="login-label" htmlFor="login-id">
        {mode === 'entrar' ? 'E-mail ou nome de usuário' : 'E-mail'}
      </label>
      <input
        id="login-id"
        className="login-input"
        name="login"
        type={mode === 'entrar' ? 'text' : 'email'}
        autoComplete={mode === 'entrar' ? 'username' : 'email'}
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <label className="login-label" htmlFor="login-password">
        Senha
      </label>
      <input
        id="login-password"
        className="login-input"
        name="password"
        type="password"
        autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'}
        minLength={mode === 'criar' ? 8 : undefined}
        required
      />
      {mode === 'criar' && (
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
      <button className="login-submit" type="submit" disabled={sending}>
        {sending ? 'Aguarde…' : mode === 'entrar' ? 'Entrar' : 'Criar conta'}
      </button>
      <p className="login-fine">
        {mode === 'entrar'
          ? 'Esqueceu a senha? Fale com a equipe do Resultados Brasil.'
          : 'Mínimo de 8 caracteres. Em seguida você escolhe seu nome de usuário.'}
      </p>
    </form>
  );
}
