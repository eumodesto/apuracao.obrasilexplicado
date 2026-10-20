export type AccessUser = {
  id: string;
  email: string;
  name: string;
  freeSecondsUsed: number;
  lastSeenAt: number | null;
  paidAt: number | null;
  paymentId: string | null;
};

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
  user: { name: string; email: string };
};

export interface AccessStore {
  upsertUser(user: Pick<AccessUser, 'id' | 'email' | 'name'>): Promise<AccessUser>;
  getUser(id: string): Promise<AccessUser | null>;
  /** Counts the time since the previous request (capped) as watched, unless already paid. */
  touch(id: string, now: number, maxGapSeconds: number): Promise<AccessUser | null>;
  markPaid(id: string, paymentId: string, paidAt: number): Promise<void>;
  savePayment(payment: PixPayment): Promise<void>;
  setPaymentStatus(id: string, status: PaymentStatus): Promise<void>;
  latestPayment(userId: string): Promise<PixPayment | null>;
  getPayment(id: string): Promise<PixPayment | null>;
}
