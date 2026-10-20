import Link from 'next/link';

/** Header of the public pages (countdown and 1st-round results). */
export function SiteHeader({ current }: { current?: 'countdown' | 'first-round' }) {
  return (
    <header className="site-header">
      <Link className="site-brand" href="/">
        Resultados <b>Brasil</b>
        <small>Eleições 2026</small>
      </Link>
      <nav aria-label="Páginas">
        {current === 'first-round' ? (
          <Link href="/">2º turno</Link>
        ) : (
          <Link href="/resultado-1-turno">Resultado do 1º turno</Link>
        )}
      </nav>
    </header>
  );
}
