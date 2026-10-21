'use client';
import { useEffect, useState } from 'react';

/**
 * First visit without an account: opens a visitor session (the free minute starts on the panel)
 * and loads the page again with it. No login screen before the panel.
 */
export function GuestStart() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/guest', { method: 'POST' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error);
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
