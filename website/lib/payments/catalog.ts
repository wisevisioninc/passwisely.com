export const CREDIT_PACKS = {
  starter: { name: "Starter · 100 credits", credits: 100, amountFen: 900 },
  pro: { name: "Pro · 400 credits", credits: 400, amountFen: 2900 },
  max: { name: "Max · 1,000 credits", credits: 1000, amountFen: 5900 },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;
export type PaymentProvider = "alipay" | "wechat";

export function isCreditPackId(value: unknown): value is CreditPackId {
  return typeof value === "string" && value in CREDIT_PACKS;
}

export function isPaymentProvider(value: unknown): value is PaymentProvider {
  return value === "alipay" || value === "wechat";
}

export function formatCny(amountFen: number): string {
  return (amountFen / 100).toFixed(2);
}
