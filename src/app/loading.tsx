/**
 * Neutral fallback for every route. The election BootShell stays on the homepage
 * (`FirstAccess`); using it here made /admin and /login look stuck on phones.
 */
export default function Loading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      Carregando…
    </div>
  );
}
