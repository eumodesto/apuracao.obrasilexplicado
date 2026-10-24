import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/features/access/access-gate';
import { GuestStart } from '@/features/access/guest-start';
import '@/features/access/access.css';
import { ChatDock } from '@/features/chat/chat';
import { FirstAccess } from '@/features/election/first-access/first-access';
import { emptyBootResult, readBootCache } from '@/features/election/first-access/read-boot-cache';
import { FirstRoundRace } from '@/features/election/race/first-round-race';
import { FirstRoundRegions } from '@/features/election/regions/first-round-regions';
import { FirstRoundBand } from '@/features/landing/round-band';
import { countIsOpen, devPaymentEnabled, mercadoPagoPublicKey } from '@/lib/access/config';
import { currentAccess } from '@/lib/access/guard';
import { readSession } from '@/lib/access/session';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const access = await currentAccess(await readSession(), undefined, undefined, { fresh: true });
  // No account yet: the panel opens for a visitor with the free minute (no login first).
  if (!access) return <GuestStart />;
  if (access.replaced) redirect('/login?erro=outro-aparelho');
  if (access.blocked)
    redirect(`/login?erro=${access.blocked === 'deleted' ? 'excluida' : 'suspensa'}`);
  if (!access.onboarded) redirect('/cadastro');
  const { initial, regions } = await readBootCache();
  // Without access, the first HTML must not carry results either.
  const locked = access.status.state === 'locked';
  return (
    <AccessGate
      initial={access.status}
      simulatedPayment={devPaymentEnabled()}
      publicKey={mercadoPagoPublicKey()}
    >
      <FirstAccess
        initial={locked ? emptyBootResult : initial}
        regions={regions}
        band={
          // Streams in on its own, so the panel never waits for the TSE.
          <Suspense key="first-round-band" fallback={null}>
            <FirstRoundBand />
          </Suspense>
        }
        regionBoard={
          // Until the 2nd-round count opens, "Por região" shows the official 1st round.
          countIsOpen() ? undefined : (
            <Suspense key="first-round-regions" fallback={null}>
              <FirstRoundRegions />
            </Suspense>
          )
        }
        raceBoard={
          // Same for the left column; the empty column keeps the grid in place while it loads.
          countIsOpen() ? undefined : (
            <Suspense key="first-round-race" fallback={<div className="race-column" />}>
              <FirstRoundRace />
            </Suspense>
          )
        }
      />
      <ChatDock />
    </AccessGate>
  );
}
