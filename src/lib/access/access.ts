import { adminEmails, freeSeconds, openAccess, priceBrl, staffEmails } from './config';
import type { AccessStatus, AccessUser } from './types';

export const isAdmin = (user: Pick<AccessUser, 'email' | 'deletedAt' | 'pausedAt'>) =>
  !user.deletedAt && !user.pausedAt && adminEmails().has(user.email.toLowerCase());

/** Visitor without an account, created on the first visit ("Visitante 1234"). */
export const isGuest = (user: Pick<AccessUser, 'id'>) => user.id.startsWith('guest:');

export const isStaff = (user: AccessUser, staff = staffEmails()) =>
  staff.has(user.email.toLowerCase());

/** One approved payment unlocks the panel for life (no end date). */
export function hasPaidAccess(user: Pick<AccessUser, 'paidAt'>) {
  return user.paidAt !== null;
}

/** Seconds to add for a request at `now`, given the previous one. Long absences count as one gap. */
export function watchedSeconds(lastSeenAt: number | null, now: number, maxGapSeconds: number) {
  if (lastSeenAt === null) return 0;
  return Math.min(Math.max((now - lastSeenAt) / 1000, 0), maxGapSeconds);
}

/**
 * Free seconds already spent. Activity from touches, plus — for visitors — wall clock since
 * `freeStartedAt`, so reloading the same browser cannot restart the free minute.
 */
export function usedFreeSeconds(user: AccessUser, now: number, waiting = false) {
  const activity = Math.max(0, user.freeSecondsUsed);
  if (waiting || !isGuest(user) || user.freeStartedAt == null) return activity;
  return Math.max(activity, Math.max(0, (now - user.freeStartedAt) / 1000));
}

export function accessStatus(
  user: AccessUser,
  now: number,
  limits = { free: freeSeconds(), price: priceBrl() },
  waiting = false,
  staff = isStaff(user),
): AccessStatus {
  const paid = staff || openAccess() || hasPaidAccess(user),
    remainingSeconds = paid
      ? 0
      : Math.max(0, Math.ceil(limits.free - usedFreeSeconds(user, now, waiting)));
  return {
    state: paid ? 'paid' : remainingSeconds > 0 ? 'free' : 'locked',
    remainingSeconds,
    freeSeconds: limits.free,
    price: limits.price,
    /** Always null: paid access has no end date. Kept for older clients. */
    paidUntil: null,
    waiting: !paid && waiting,
    staff,
    guest: isGuest(user),
    stickers: user.stickerCredits ?? 0,
    user: { name: user.name, email: user.email, username: user.username },
  };
}
