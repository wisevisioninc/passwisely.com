import { env } from "cloudflare:workers";

// Retain signature verification for historical Stripe order callbacks. New
// purchases use the single CNY catalog and the Alipay/WeChat checkout route.
export function getStripeWebhookSecret(): string {
  const secret = (env as unknown as Record<string, string>).STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Payment webhook is not configured.");
  return secret;
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
