import { SiteHeader } from '@/features/landing/site-header';
import '@/features/landing/landing.css';
import './first-round.css';
export default function Loading() {
  return (
    <div className="landing round">
      <SiteHeader current="first-round" />
      <main className="round-main round-unavailable" id="conteudo">
        <p className="round-muted" role="status">
          Buscando o resultado oficial no TSE…
        </p>
      </main>
    </div>
  );
}
