import { env } from "cloudflare:workers";

export const CREDIT_PACKS = {
  starter: { name: "Starter · 100 credits", credits: 100, amountCents: 900 },
  pro: { name: "Pro · 400 credits", credits: 400, amountCents: 2900 },
  max: { name: "Max · 1,000 credits", credits: 1000, amountCents: 5900 },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

export function isCreditPackId(value: unknown): value is CreditPackId {
  return typeof value === "string" && value in CREDIT_PACKS;
}

export function getStripeSecret(): string {
  const secret = (env as unknown as Record<string, string>).STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Payment is not configured.");
  return secret;
}

export function getStripeWebhookSecret(): string {
  const secret = (env as unknown as Record<string, string>).STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Payment webhook is not configured.");
  return secret;
}

export async function createStripeCheckout(
  input: {
    origin: string;
    email: string;
    purchaseId: string;
    packId: CreditPackId;
  },
): Promise<{ id: string; url: string }> {
  const pack = CREDIT_PACKS[input.packId];
  const params = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    customer_email: input.email,
    success_url: `${input.origin}/?payment=success#account`,
    cancel_url: `${input.origin}/?payment=cancelled#pricing`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.amountCents),
    "line_items[0][price_data][product_data][name]": `PassWisely ${pack.name}`,
    "metadata[purchaseId]": input.purchaseId,
    "metadata[credits]": String(pack.credits),
    "metadata[packId]": input.packId,
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${getStripeSecret()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const payload = (await response.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!response.ok || !payload.id || !payload.url) {
    throw new Error(payload.error?.message || "Could not create checkout.");
  }
  return { id: payload.id, url: payload.url };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
): Promise<boolean> {
  const fields = signatureHeader.split(",").map((part) => part.split("="));
  const timestamp = fields.find(([key]) => key === "t")?.[1];
  const signatures = fields
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getStripeWebhookSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = toHex(new Uint8Array(digest));
  return signatures.some((signature) => {
    if (signature.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) {
      difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
    }
    return difference === 0;
  });
}
