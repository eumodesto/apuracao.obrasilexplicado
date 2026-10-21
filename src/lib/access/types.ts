export type AccessUser = {
  id: string;
  email: string;
  name: string;
  freeSecondsUsed: number;
  lastSeenAt: number | null;
  paidAt: number | null;
  paymentId: string | null;
  /** The only session allowed to use the account; a new login replaces it. */
  sessionId: string | null;
  /** How many times a login replaced an active session (for spotting shared accounts). */
  sessionChanges: number;
  /** Public, unique (case-insensitive) name chosen at sign-up. */
  username: string | null;
  /** Party code from the parties list, or 'none' ("Prefiro não informar"). */
  party: string | null;
  /** LGPD consent to use the party (sensitive data); null when no party was given. */
  partyConsentAt: number | null;
  onboardedAt: number | null;
  createdAt: number | null;
  /** Suspended by a moderator: no panel, no chat, until unpaused. */
  pausedAt: number | null;
  pausedReason: string | null;
  /** Removed at the person's or the moderators' request: personal data is anonymized. */
  deletedAt: number | null;
  /** When the current profile photo was taken; null without a photo. */
  photoVersion: number | null;
};

export type UserQuery = { query?: string; limit: number; offset: number };

export type AccessStats = {
  users: number;
  onboarded: number;
  paid: number;
  paused: number;
  deleted: number;
  /** Accounts that switched devices at least once (possible sharing). */
  switchedDevices: number;
  revenue: number;
  approvedPayments: number;
};

export type ProfileInput = { username: string; party: string; partyConsentAt: number | null };

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

export type PixPayment = {
  id: string;
  userId: string;
  status: PaymentStatus;
  amount: number;
  qrCode: string;
  qrCodeBase64: string | null;
  expiresAt: number;
  createdAt: number;
};

export type AccessState = 'free' | 'paid' | 'locked';

export type AccessStatus = {
  state: AccessState;
  remainingSeconds: number;
  freeSeconds: number;
  price: number;
  paidUntil: string;
  /** True while the count has not started: free time is not being spent. */
  waiting: boolean;
  /** Team access (STAFF_EMAILS): always paid, never asked to pay. */
  staff: boolean;
  user: { name: string; email: string; username: string | null };
};

export interface AccessStore {
  upsertUser(user: Pick<AccessUser, 'id' | 'email' | 'name'>): Promise<AccessUser>;
  getUser(id: string): Promise<AccessUser | null>;
  /** Makes `sessionId` the account's only valid session, replacing any other. */
  startSession(id: string, sessionId: string): Promise<void>;
  /** Saves the sign-up profile. 'taken' when another account has the username. */
  saveProfile(id: string, profile: ProfileInput, now: number): Promise<'ok' | 'taken' | 'missing'>;
  usernameTaken(username: string, exceptId?: string): Promise<boolean>;
  /** The account with this username (case-insensitive), for signing in by username. */
  userIdByUsername(username: string): Promise<string | null>;
  /**
   * Records activity. Counts the time since the previous request (capped) as watched, unless
   * already paid or `count` is false (the election count has not started).
   */
  touch(
    id: string,
    now: number,
    maxGapSeconds: number,
    count?: boolean,
  ): Promise<AccessUser | null>;
  markPaid(id: string, paymentId: string, paidAt: number): Promise<void>;
  savePayment(payment: PixPayment): Promise<void>;
  setPaymentStatus(id: string, status: PaymentStatus): Promise<void>;
  latestPayment(userId: string): Promise<PixPayment | null>;
  getPayment(id: string): Promise<PixPayment | null>;
  /** Suspends (with a reason) or, with null, reactivates the account. */
  setPaused(id: string, pause: { at: number; reason: string } | null): Promise<boolean>;
  /** Deletes personal data (e-mail, name, username, party) and ends the session; keeps payments. */
  anonymize(id: string, at: number): Promise<boolean>;
  /** Records a new profile photo (its version) or, with null, its removal. */
  setPhoto(id: string, version: number | null): Promise<boolean>;
  listUsers(query: UserQuery): Promise<{ users: AccessUser[]; total: number }>;
  stats(): Promise<AccessStats>;
}
