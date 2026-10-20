import { hasPaidAccess, isAdmin, isStaff } from '@/lib/access/access';
import type { AccessUser } from '@/lib/access/types';
import { photoRef } from '@/lib/profile/photo';

/** What the admin screens show about an account. */
export function adminUser(user: AccessUser, now = Date.now()) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    party: user.party,
    photo: photoRef(user),
    paid: hasPaidAccess(user, now),
    paidAt: user.paidAt,
    staff: isStaff(user),
    admin: isAdmin(user),
    freeSecondsUsed: Math.round(user.freeSecondsUsed),
    sessionChanges: user.sessionChanges,
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt,
    onboardedAt: user.onboardedAt,
    pausedAt: user.pausedAt,
    pausedReason: user.pausedReason,
    deletedAt: user.deletedAt,
  };
}

export type AdminUser = ReturnType<typeof adminUser>;
