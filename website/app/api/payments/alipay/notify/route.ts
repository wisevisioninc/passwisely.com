import { verifyAlipayNotification } from "@/lib/payments/alipay";
import { getAlipayConfig } from "@/lib/payments/config";
import {
  completePurchase,
  findPurchaseByMerchantOrder,
} from "@/lib/payments/orders";

function text(value: "success" | "failure", status = 200): Response {
  return new Response(value, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  try {
    const params = new URLSearchParams(await request.text());
    if (!(await verifyAlipayNotification(params))) return text("failure", 400);
    const tradeStatus = params.get("trade_status");
    const merchantOrderNo = params.get("out_trade_no") || "";
    const transactionId = params.get("trade_no") || "";
    if (
      params.get("app_id") !== getAlipayConfig().appId ||
      !["TRADE_SUCCESS", "TRADE_FINISHED"].includes(tradeStatus || "") ||
      !merchantOrderNo ||
      !transactionId
    ) {
      return text("failure", 400);
    }
    const purchase = await findPurchaseByMerchantOrder(merchantOrderNo);
    if (
      !purchase ||
      purchase.provider !== "alipay" ||
      purchase.currency !== "CNY" ||
      Number(params.get("total_amount")) !== purchase.amountMinor / 100
    ) {
      return text("failure", 400);
    }
    await completePurchase({
      purchase,
      transactionId,
      eventId: `alipay:${params.get("notify_id") || transactionId}`,
      eventType: `alipay:${tradeStatus}`,
    });
    return text("success");
  } catch {
    return text("failure", 500);
  }
}
