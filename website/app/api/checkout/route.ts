import { getCurrentUser, jsonError } from "@/lib/auth";
import { createAlipayPagePayment } from "@/lib/payments/alipay";
import {
  CREDIT_PACKS,
  isCreditPackId,
  isPaymentProvider,
} from "@/lib/payments/catalog";
import {
  createPurchase,
  markPurchaseFailed,
} from "@/lib/payments/orders";
import { createWechatNativePayment } from "@/lib/payments/wechat";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sign in before purchasing credits.", 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const packId = body.packId;
  const provider = body.provider;
  if (!isCreditPackId(packId)) return jsonError("Unknown credit pack.", 400);
  if (!isPaymentProvider(provider)) {
    return jsonError("Choose Alipay or WeChat Pay.", 400);
  }
  const pack = CREDIT_PACKS[packId];
  const purchase = await createPurchase({ userId: user.id, packId, provider });

  try {
    const origin = new URL(request.url).origin;
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
      });
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
    });
  } catch (error) {
    await markPurchaseFailed(purchase.id);
    return jsonError(
      error instanceof Error ? error.message : "Checkout is unavailable.",
      503,
    );
  }
}
