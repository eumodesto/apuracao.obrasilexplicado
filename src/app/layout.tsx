import type { Metadata } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

/** One sober family for the whole site (titles, panel and numbers). */
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});
export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3000'),
  title: 'Resultados Brasil — Eleições 2026',
  description:
    'Acompanhe a apuração para Presidente da República nas Eleições 2026 com dados oficiais fornecidos pelo TSE. Painel independente.',
  openGraph: {
    title: 'Resultados Brasil — Eleições 2026',
    description: 'Cada voto. O Brasil inteiro. Apuração presidencial com dados oficiais do TSE.',
    locale: 'pt_BR',
    type: 'website',
  },
  robots: { index: true, follow: true },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={plex.variable}>
      <body>
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
