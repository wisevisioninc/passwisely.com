import { getCurrentUser, jsonError } from "@/lib/auth";
import { getPublicSiteOrigin } from "@/lib/public-site";
import { createAlipayPagePayment } from "@/lib/payments/alipay";
import {
  CREDIT_PACKS,
  isCreditPackId,
  isPaymentProvider,
} from "@/lib/payments/catalog";
import { createPurchase } from "@/lib/payments/orders";
import { createWechatNativePayment } from "@/lib/payments/wechat";

// Keep the method rejection explicit and complete; GET never creates a purchase.
export function GET() {
  return Response.json({ error: "Use POST to create a purchase." }, {
    status: 405,
    headers: { allow: "POST", "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sign in before purchasing credits.", 401);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("Invalid checkout request.", 400);
  }
  const packId = (body as Record<string, unknown>).packId;
  const provider = (body as Record<string, unknown>).provider;
  if (packId === "starter" || packId === "pro" || packId === "max") {
    return Response.json({ error: "Plans have changed. Refresh this page before purchasing.", code: "PRICING_CHANGED" }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  if (!isCreditPackId(packId)) return jsonError("Unknown credit pack.", 400);
  if (!isPaymentProvider(provider)) {
    return jsonError("Choose Alipay or WeChat Pay.", 400);
  }
  let origin: string;
  try {
    origin = getPublicSiteOrigin();
  } catch {
    return jsonError("Payments are temporarily unavailable.", 503, "PAYMENT_UNAVAILABLE");
  }
  const pack = CREDIT_PACKS[packId];
  const purchase = await createPurchase({ userId: user.id, packId, provider });

  try {
    const description = `PassWisely ${pack.name}`;
    if (provider === "alipay") {
      const payment = await createAlipayPagePayment({
        origin,
        merchantOrderNo: purchase.merchantOrderNo,
        subject: description,
        amountFen: purchase.amountMinor,
      });
      return Response.json({
        provider,
        orderId: purchase.id,
        url: payment.redirectUrl,
      }, { headers: { "cache-control": "no-store" } });
    }
    const payment = await createWechatNativePayment({
      origin,
      merchantOrderNo: purchase.merchantOrderNo,
      description,
      amountFen: purchase.amountMinor,
    });
    return Response.json({
      provider,
      orderId: purchase.id,
      url: payment.codeUrl,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    // A timeout, unreadable response or failed response verification does not
    // establish that the provider rejected the order. Keep it payable so a
    // later verified success notification can reach the transaction owner.
    return Response.json({
      error: "Payment initiation could not be confirmed. Check your credits or contact support before paying again.",
      code: "CHECKOUT_UNCONFIRMED",
      orderId: purchase.id,
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
