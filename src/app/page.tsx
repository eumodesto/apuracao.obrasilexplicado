import { redirect } from 'next/navigation';
import { AccessGate } from '@/features/access/access-gate';
import { ChatDock } from '@/features/chat/chat';
import { FirstAccess } from '@/features/election/first-access/first-access';
import { emptyBootResult, readBootCache } from '@/features/election/first-access/read-boot-cache';
import { Countdown } from '@/features/landing/countdown';
import { isStaff } from '@/lib/access/access';
import { activeSession } from '@/lib/access/auth';
import { countIsOpen, countStartsAt, devPaymentEnabled } from '@/lib/access/config';
import { currentAccess } from '@/lib/access/guard';
import { readSession } from '@/lib/access/session';
export const dynamic = 'force-dynamic';
export default async function Page() {
  // Before the count opens, everyone but the team sees the countdown.
  if (!countIsOpen()) {
    const active = await activeSession();
    if (!active || !isStaff(active.user)) return <Countdown startsAt={countStartsAt()} />;
  }
  const access = await currentAccess(await readSession(), undefined, undefined, { fresh: true });
  if (!access) redirect('/login');
  if (access.replaced) redirect('/login?erro=outro-aparelho');
  if (!access.onboarded) redirect('/cadastro');
  const { initial, regions } = await readBootCache();
  // Without access, the first HTML must not carry results either.
  const locked = access.status.state === 'locked';
  return (
    <AccessGate initial={access.status} simulatedPayment={devPaymentEnabled()}>
      <FirstAccess initial={locked ? emptyBootResult : initial} regions={regions} />
      <ChatDock />
    </AccessGate>
  );
}
