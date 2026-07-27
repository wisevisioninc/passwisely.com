import { getWechatPayConfig } from "@/lib/payments/config";
import {
  completePurchase,
  findPurchaseByMerchantOrder,
} from "@/lib/payments/orders";
import { verifyAndDecryptWechatNotification } from "@/lib/payments/wechat";

function failure(message: string, status: number): Response {
  return Response.json({ code: "FAIL", message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const resource = await verifyAndDecryptWechatNotification(
      body,
      request.headers,
    );
    const config = getWechatPayConfig();
    const merchantOrderNo = String(resource.out_trade_no || "");
    const transactionId = String(resource.transaction_id || "");
    const amount = resource.amount as
      | { total?: number; currency?: string }
      | undefined;
    if (
      resource.trade_state !== "SUCCESS" ||
      resource.appid !== config.appId ||
      resource.mchid !== config.mchId ||
      !merchantOrderNo ||
      !transactionId
    ) {
      return failure("Invalid payment state.", 400);
    }
    const purchase = await findPurchaseByMerchantOrder(merchantOrderNo);
    if (
      !purchase ||
      purchase.provider !== "wechat" ||
      amount?.currency !== "CNY" ||
      amount.total !== purchase.amountMinor
    ) {
      return failure("Order verification failed.", 400);
    }
    await completePurchase({
      purchase,
      transactionId,
      eventId: `wechat:${transactionId}`,
      eventType: "wechat:TRANSACTION.SUCCESS",
    });
    return Response.json({ code: "SUCCESS", message: "成功" });
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Callback processing failed.",
      500,
    );
  }
}
