'use client';
import { useEffect, useState } from 'react';

/** Must match server guest / device cookies; kept here to avoid importing server modules. */
const GUEST_RESUME_KEY = 'rb_guest_resume';
const DEVICE_STORAGE_KEY = 'rb_device';

function readOrCreateDeviceId() {
  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,80}$/.test(existing)) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_STORAGE_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/**
 * First visit without an account: opens a visitor session (the free minute starts on the panel)
 * and loads the page again with it. No login screen before the panel.
 *
 * Keeps a signed resume token and a device id in localStorage so clearing cookies alone — or
 * opening another profile that still hits the same network — cannot mint another free minute.
 */
export function GuestStart() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // One slow or failed answer must not strand the visitor on this screen: each attempt gives up
    // after 12 s and a few retries run on their own. A visitor already created is resumed (same
    // device id / resume token), so retrying never mints a second free minute.
    const attempts = 4;
    const open = async () => {
      const resume = window.localStorage.getItem(GUEST_RESUME_KEY);
      const deviceId = readOrCreateDeviceId();
      let failure: unknown = null;
      for (let attempt = 0; attempt < attempts && !cancelled; attempt++) {
        if (attempt) await new Promise((done) => setTimeout(done, 1_000 * attempt));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
          const response = await fetch('/api/guest', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resume, deviceId }),
            signal: controller.signal,
          });
          const body = await response.json().catch(() => ({}));
          if (response.ok) return body;
          failure = typeof body.error === 'string' ? new Error(body.error) : null;
          // A 4xx (e.g. rate limit) is a real answer: show it instead of retrying.
          if (response.status < 500) break;
        } catch {
          // Timeout or network failure (browser-language message, not worth showing): try again.
        } finally {
          clearTimeout(timeout);
        }
      }
      throw failure ?? new Error('Falha de conexão. Recarregue a página.');
    };
    (async () => {
      try {
        const body = await open();
        try {
          if (typeof body.resume === 'string')
            window.localStorage.setItem(GUEST_RESUME_KEY, body.resume);
          if (typeof body.deviceId === 'string')
            window.localStorage.setItem(DEVICE_STORAGE_KEY, body.deviceId);
        } catch {
          // Private mode may block storage; HttpOnly cookies still bind this profile.
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
