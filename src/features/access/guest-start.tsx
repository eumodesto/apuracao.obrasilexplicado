'use client';
import { useEffect, useState } from 'react';
/** Must match the server guest cookie binding; kept here to avoid importing server modules. */
const GUEST_RESUME_KEY = 'rb_guest_resume';

/**
 * First visit without an account: opens a visitor session (the free minute starts on the panel)
 * and loads the page again with it. No login screen before the panel.
 *
 * Keeps a signed resume token in localStorage so clearing cookies alone does not mint a new
 * visitor with a fresh free minute in the same browser.
 */
export function GuestStart() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resume =
          typeof window !== 'undefined' ? window.localStorage.getItem(GUEST_RESUME_KEY) : null;
        const response = await fetch('/api/guest', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error);
        if (typeof body.resume === 'string')
          try {
            window.localStorage.setItem(GUEST_RESUME_KEY, body.resume);
          } catch {
            // Private mode may block storage; the HttpOnly cookie still binds the visitor.
          }
        if (!cancelled) window.location.reload();
      } catch (problem) {
        if (!cancelled)
          setError(
            problem instanceof Error && problem.message
              ? problem.message
              : 'Falha de conexão. Recarregue a página.',
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <main className="guest-start" id="conteudo" aria-busy={!error}>
      <p className="guest-start-brand">Resultados Brasil · Eleições 2026</p>
      <p role={error ? 'alert' : 'status'}>{error ?? 'Abrindo a apuração ao vivo…'}</p>
      {error && (
        <button type="button" onClick={() => window.location.reload()}>
          Tentar de novo
        </button>
      )}
    </main>
  );
}
