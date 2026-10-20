import { adminEmails, freeSeconds, paidAccessEndsAt, priceBrl, staffEmails } from './config';
import type { AccessStatus, AccessUser } from './types';

export const isAdmin = (user: Pick<AccessUser, 'email' | 'deletedAt' | 'pausedAt'>) =>
  !user.deletedAt && !user.pausedAt && adminEmails().has(user.email.toLowerCase());

export const isStaff = (user: AccessUser, staff = staffEmails()) =>
  staff.has(user.email.toLowerCase());

export function hasPaidAccess(user: AccessUser, now: number, endsAt = paidAccessEndsAt()) {
  return user.paidAt !== null && now < endsAt;
}

/** Seconds to add for a request at `now`, given the previous one. Long absences count as one gap. */
export function watchedSeconds(lastSeenAt: number | null, now: number, maxGapSeconds: number) {
  if (lastSeenAt === null) return 0;
  return Math.min(Math.max((now - lastSeenAt) / 1000, 0), maxGapSeconds);
}

export function accessStatus(
  user: AccessUser,
  now: number,
  limits = { free: freeSeconds(), endsAt: paidAccessEndsAt(), price: priceBrl() },
  waiting = false,
  staff = isStaff(user),
): AccessStatus {
  const paid = staff || hasPaidAccess(user, now, limits.endsAt),
    remainingSeconds = paid ? 0 : Math.max(0, Math.ceil(limits.free - user.freeSecondsUsed));
  return {
    state: paid ? 'paid' : remainingSeconds > 0 ? 'free' : 'locked',
    remainingSeconds,
    freeSeconds: limits.free,
    price: limits.price,
    paidUntil: new Date(limits.endsAt).toISOString(),
    waiting: !paid && waiting,
    staff,
    user: { name: user.name, email: user.email, username: user.username },
  };
}
