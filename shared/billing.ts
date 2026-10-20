// Shared product terms; grant validity and accounting are enforced by the database.
export const TRIAL_CREDITS = 20;

export interface CreditBalanceDetails {
  balance: number;
  permanentBalance: number;
  expiringBalance: number;
  nextExpiry: string | null;
}
