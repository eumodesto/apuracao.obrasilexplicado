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

/**
 * Access unlocked by an administrator or staff list — never a Mercado Pago charge.
 * `payment_id` is `admin:grant` / `staff:grant`, not an MP payment id.
 */
export function isGrantedAccess(user: Pick<AccessUser, 'paymentId'>) {
  const id = user.paymentId ?? '';
  return id.startsWith('admin:') || id.startsWith('staff:');
}

/** Seconds to add for a request at `now`, given the previous one. Long absences count as one gap. */
export function watchedSeconds(lastSeenAt: number | null, now: number, maxGapSeconds: number) {
  if (lastSeenAt === null) return 0;
  return Math.min(Math.max((now - lastSeenAt) / 1000, 0), maxGapSeconds);
}

export function accessStatus(
  user: AccessUser,
  now: number,
  limits = { free: freeSeconds(), price: priceBrl() },
  waiting = false,
  staff = isStaff(user),
): AccessStatus {
  const paid = staff || openAccess() || hasPaidAccess(user),
    // Free time is only the watched activity stored on the account. The same browser keeps the
    // same guest id (cookie + localStorage resume), so a reload cannot mint another minute;
    // closing the tab must pause, not burn the minute in the background.
    remainingSeconds = paid ? 0 : Math.max(0, Math.ceil(limits.free - user.freeSecondsUsed));
  const granted = isGrantedAccess(user);
  return {
    state: paid ? 'paid' : remainingSeconds > 0 ? 'free' : 'locked',
    remainingSeconds,
    freeSeconds: limits.free,
    price: limits.price,
    /** Always null: paid access has no end date. Kept for older clients. */
    paidUntil: null,
    waiting: !paid && waiting,
    staff,
    /** Unlocked by admin/staff — no Mercado Pago; stickers do not spend credits. */
    granted,
    guest: isGuest(user),
    stickers: user.stickerCredits ?? 0,
    user: { name: user.name, email: user.email, username: user.username },
  };
}
