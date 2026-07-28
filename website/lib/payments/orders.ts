import { adminRest, adminRpc } from "@/lib/supabase";
import {
  CREDIT_PACKS,
  type CreditPackId,
  type PaymentProvider,
} from "./catalog";

export interface PurchaseRow {
  id: string;
  userId: string;
  merchantOrderNo: string;
  provider: PaymentProvider | "stripe";
  credits: number;
  amountMinor: number;
  currency: string;
  status: string;
  providerTransactionId: string | null;
}

function merchantOrderNo(): string {
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  return `PW${Date.now().toString(36)}${random}`.toUpperCase();
}

export async function createPurchase(input: {
  userId: string;
  packId: CreditPackId;
  provider: PaymentProvider;
}): Promise<PurchaseRow> {
  const pack = CREDIT_PACKS[input.packId];
  const purchase: PurchaseRow = {
    id: crypto.randomUUID(),
    userId: input.userId,
    merchantOrderNo: merchantOrderNo(),
    provider: input.provider,
    credits: pack.credits,
    amountMinor: pack.amountFen,
    currency: "CNY",
    status: "pending",
    providerTransactionId: null,
  };
  await adminRest("purchases", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      id: purchase.id,
      user_id: purchase.userId,
      pack_id: input.packId,
      credits: purchase.credits,
      amount_minor: purchase.amountMinor,
      currency: purchase.currency,
      status: purchase.status,
      provider: purchase.provider,
      merchant_order_no: purchase.merchantOrderNo,
    }),
  });
  return purchase;
}

export async function findPurchaseByMerchantOrder(
  merchantOrderNo: string,
): Promise<PurchaseRow | null> {
  const rows = await adminRest<
    Array<{
      id: string;
      user_id: string;
      merchant_order_no: string;
      provider: PaymentProvider | "stripe";
      credits: number;
      amount_minor: number;
      currency: string;
      status: string;
      provider_transaction_id: string | null;
    }>
  >(
    `purchases?merchant_order_no=eq.${encodeURIComponent(merchantOrderNo)}&select=id,user_id,merchant_order_no,provider,credits,amount_minor,currency,status,provider_transaction_id&limit=1`,
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        merchantOrderNo: row.merchant_order_no,
        provider: row.provider,
        credits: row.credits,
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: row.status,
        providerTransactionId: row.provider_transaction_id,
      }
    : null;
}

export async function markPurchaseFailed(id: string): Promise<void> {
  await adminRest(
    `purchases?id=eq.${encodeURIComponent(id)}&status=eq.pending`,
    {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed" }),
    },
  );
}

export async function completePurchase(input: {
  purchase: PurchaseRow;
  eventId: string;
  eventType: string;
  transactionId: string;
}): Promise<"completed" | "duplicate"> {
  if (
    input.purchase.status === "completed" &&
    input.purchase.providerTransactionId === input.transactionId
  ) {
    return "duplicate";
  }
  if (input.purchase.status !== "pending") {
    throw new Error(`Purchase is not payable: ${input.purchase.status}`);
  }
  return adminRpc<"completed" | "duplicate">("complete_purchase", {
    p_purchase_id: input.purchase.id,
    p_transaction_id: input.transactionId,
    p_event_id: input.eventId,
    p_event_type: input.eventType,
  });
}
