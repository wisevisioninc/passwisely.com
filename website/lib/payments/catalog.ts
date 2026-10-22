import { TRIAL_CREDITS } from "../../../shared/billing";

export { TRIAL_CREDITS };

// Publicly purchasable IDs are versioned. Historical orders retain their own
// price/credit/policy snapshot; these IDs never reinterpret an old pending order.
export const CREDIT_PACKS = {
  pro_monthly_v2: {
    name: "进阶包",
    nameEn: "Pro",
    credits: 200,
    amountFen: 9900,
    validityDays: 30,
    manualRenewal: true,
  },
  unlimited_monthly_v2: {
    name: "无限制包",
    nameEn: "Unlimited",
    credits: 1000,
    amountFen: 29900,
    validityDays: 30,
    manualRenewal: true,
  },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;
export type PaymentProvider = "alipay" | "wechat";

// New checkout availability is separate from historical payment identity.
// Keep WeChat orders and callbacks readable while its onboarding is pending.
export const CHECKOUT_PROVIDERS = ["alipay"] as const satisfies readonly PaymentProvider[];

export function isCheckoutProvider(value: unknown): value is PaymentProvider {
  return CHECKOUT_PROVIDERS.some(provider => provider === value);
}

export function isCreditPackId(value: unknown): value is CreditPackId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CREDIT_PACKS, value);
}

export function isPaymentProvider(value: unknown): value is PaymentProvider {
  return value === "alipay" || value === "wechat";
}

export function formatCny(amountFen: number): string {
  return (amountFen / 100).toFixed(2);
}
