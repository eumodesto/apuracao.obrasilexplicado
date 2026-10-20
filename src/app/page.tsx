import { redirect } from 'next/navigation';
import { AccessGate } from '@/features/access/access-gate';
import { FirstAccess } from '@/features/election/first-access/first-access';
import { emptyBootResult, readBootCache } from '@/features/election/first-access/read-boot-cache';
import { devPaymentEnabled } from '@/lib/access/config';
import { currentAccess } from '@/lib/access/guard';
import { readSession } from '@/lib/access/session';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const access = await currentAccess(await readSession());
  if (!access) redirect('/login');
  const { initial, regions } = await readBootCache();
  // Without access, the first HTML must not carry results either.
  const locked = access.status.state === 'locked';
  return (
    <AccessGate initial={access.status} simulatedPayment={devPaymentEnabled()}>
      <FirstAccess initial={locked ? emptyBootResult : initial} regions={regions} />
    </AccessGate>
  );
}
